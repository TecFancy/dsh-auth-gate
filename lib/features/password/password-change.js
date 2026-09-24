import { checkPasswordPolicy, parseCookieHeader, parseFormBody } from "../../shared/index.js";
import { buildSetCookie } from "../../session/index.js";
import { methodNotAllowed } from "../../http/index.js";
import { DUMMY_HASH } from "./password.js";
/** 失败日志常量串（不反射请求内容，§1 审计要求）。 */
const REJECTED = "password change rejected";
/** 文件缺失告警只触发一次（插件单实例，等价进程级一次，P7）。 */
let warnedMissing = false;
/**
 * POST /auth/password（P1 §1）。处理顺序冻结，不得重排：
 * method 405 → parseFormBody(415/413) → 会话 cookie(401) → 限速桶(429) → 读 users(503)
 * → 恒时验证旧口令(401) → TOTP(401) → 策略(400) → hash → 锁内写盘(503)
 * → recordSuccess + 撤销全部会话 → 清 cookie + 200。
 * 顺序硬约束：写盘成功后才撤销会话；写盘失败绝不允许出现「全被踢但密码没改」。
 */
export async function handlePasswordChange(deps, req, res) {
    if (req.method !== "POST") {
        methodNotAllowed(res, "POST");
        return;
    }
    let params;
    try {
        params = await parseFormBody(req);
    }
    catch (error) {
        respondFormError(res, error);
        return;
    }
    const { current, newPassword, code } = requestOf(params);
    const subject = locateSession(deps, req)?.subject;
    if (subject === undefined) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
    }
    const ctx = {
        ip: clientIpOf(deps, req),
        subject,
        current,
        secrets: [current, newPassword, code],
    };
    const lockout = lockoutSeconds(deps, ctx.ip, subject);
    if (lockout !== undefined) {
        deps.logger.info("rate limit exceeded");
        res.setHeader("retry-after", String(lockout));
        sendJson(res, 429, { error: "locked", retryAfter: lockout });
        return;
    }
    // 读失败（含文件损坏/权限）不计失败：系统错误不该把用户锁在门外。
    const loaded = await loadUsersOr503(deps, res, ctx);
    if (loaded === undefined)
        return;
    const user = await authenticateCurrent(deps, loaded.snapshot.users.get(subject), current);
    if (user === undefined) {
        reject(deps, res, ctx, 401, { error: "invalid_credentials" });
        return;
    }
    // TOTP 在策略/写盘之前（§4.1-3，有意为之）：策略不过也会烧掉当前 30 s 窗，
    // 用户需等下一枚验证码；后置校验会扩大码重放面，故不重排。
    if (!totpAccepted(deps, user, ctx, code)) {
        reject(deps, res, ctx, 401, { error: "invalid_totp" });
        return;
    }
    const policy = await checkPasswordPolicy(newPassword, {
        oldPasswordHash: user.passwordHash,
        verifyOld: deps.verify,
    });
    if (!policy.ok) {
        reject(deps, res, ctx, 400, { error: "policy", rules: policy.rules });
        return;
    }
    const hashed = await hashOr503(deps, res, ctx, newPassword);
    if (hashed === undefined)
        return;
    if (!(await writeNewHash(deps, res, ctx, hashed)))
        return;
    deps.limiter.recordSuccess(ctx.ip, subject);
    // 写盘已成功：撤销失败绝不改变 200 语义（口令确实改了），只进 error 日志。
    // TODO(auth-p2): 撤销失败不重试 ⇒「新口令已生效但旧 cookie 仍可用」窗口由会话 TTL 兜底。
    await deps.revoke(subject);
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", buildSetCookie(deps.cookieName, "", 0, deps.cookieSecure));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    deps.logger.info("password changed");
}
/** 请求字段（**不 trim 不截断**：口令按原始码点判定）。 */
function requestOf(params) {
    return {
        current: params.get("current") ?? "",
        newPassword: params.get("password") ?? "",
        code: params.get("code") ?? "",
    };
}
/** 会话定位：只认 cookie（M5），Bearer 不参与；store/token 无效一律 undefined。 */
function locateSession(deps, req) {
    const store = deps.sessions();
    const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
    if (store === undefined || token === undefined || token === "")
        return undefined;
    return store.getByToken(token);
}
/** D19：注入的解析器（受信反代 IP 头）优先，缺省回退 socket 地址。 */
function clientIpOf(deps, req) {
    return deps.clientIp?.(req) ?? req.socket.remoteAddress ?? "";
}
/** 恒时验证旧口令（P9 同款）：未知用户跑 DUMMY_HASH，禁用用户也跑真实验证；通过才返回用户。 */
async function authenticateCurrent(deps, candidate, current) {
    const ok = await deps.verify(current, candidate?.passwordHash ?? DUMMY_HASH);
    return ok && candidate !== undefined && !candidate.disabled ? candidate : undefined;
}
/**
 * TOTP 门（§4）：off 忽略 secret；optional 有 secret 必填；**required 无 secret 也拒绝**
 * （不给无第二因子的存量会话留改密通道，对齐登录路径）。任何失败都计失败（§4.1-1）。
 */
function totpAccepted(deps, user, ctx, code) {
    if (deps.totpMode === "off")
        return true;
    const secret = user.totpSecret;
    if (secret === undefined)
        return deps.totpMode !== "required";
    const counter = deps.verifyTotp(secret, code, deps.now());
    return counter !== undefined && deps.replayCheck(ctx.subject, counter, code);
}
/** 4xx 拒绝统一口径：计失败 + 常量日志 + JSON body（明文永不入日志）。 */
function reject(deps, res, ctx, status, body) {
    deps.limiter.recordFailure(ctx.ip, ctx.subject);
    deps.logger.info(REJECTED);
    sendJson(res, status, body);
}
/** 读取用户文件；失败 → 503 + error 日志并返回 undefined（不计失败）。 */
async function loadUsersOr503(deps, res, ctx) {
    try {
        const loaded = await deps.loadUsers();
        if (loaded.missing && !warnedMissing) {
            warnedMissing = true;
            deps.logger.warn(`users file not found: ${deps.usersPath} (all password changes rejected)`);
        }
        return loaded;
    }
    catch (error) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("user store unavailable");
        deps.logger.error(`user store unavailable: ${safeError(error, ctx.secrets)}`);
        return undefined;
    }
}
/** 新口令哈希；失败 → 503（同写盘失败口径：计失败 + error 日志）。 */
async function hashOr503(deps, res, ctx, newPassword) {
    try {
        return await deps.hash(newPassword);
    }
    catch (error) {
        deps.limiter.recordFailure(ctx.ip, ctx.subject);
        deps.logger.error(`password change failed: ${safeError(error, ctx.secrets)}`);
        sendUnavailable(res);
        return undefined;
    }
}
/**
 * 锁内写盘（唯一变更入口）；失败 → recordFailure + 503，**绝不吊销会话**。
 * 锁内复核（A6 §10）：mutator 在 `mutateUsersFile` 的新鲜快照上重新验证现口令，
 * 因此 CAS 冲突后的重跑是安全的：他人并发改过口令时宁可 503，也不覆盖写入。
 * mutator 内不得再调 `mutateUsersFile`（A8 自死锁）。
 */
async function writeNewHash(deps, res, ctx, hashed) {
    try {
        await deps.mutateUsers(async (snapshot) => {
            const record = snapshot.users.get(ctx.subject);
            if (record === undefined) {
                throw new Error(`user not found in users snapshot: ${ctx.subject}`);
            }
            if (!(await deps.verify(ctx.current, record.passwordHash))) {
                throw new Error(`users file changed concurrently: ${ctx.subject}`);
            }
            record.passwordHash = hashed;
            // B1（§10）：自助改密成功即清 must_change_password（P2 登录门不再立刻拦一次）。
            // 写盘侧对 false 不落盘，删除即「无该字段」；CLI `user passwd` 有意不清（运维重置通道）。
            if (record.mustChangePassword === true)
                delete record.mustChangePassword;
        });
        return true;
    }
    catch (error) {
        deps.limiter.recordFailure(ctx.ip, ctx.subject);
        deps.logger.error(`password change failed: ${safeError(error, ctx.secrets)}`);
        sendUnavailable(res);
        return false;
    }
}
/** 503 统一写出（users 文件读/写失败语义）。 */
function sendUnavailable(res) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("password change unavailable");
}
/** 限速门（P10）：锁定 → retry-after 秒数；放行 → undefined。 */
function lockoutSeconds(deps, ip, subject) {
    const check = deps.limiter.check(ip, subject);
    return check.allowed ? undefined : check.retryAfterSeconds;
}
/**
 * 依赖抛出的 message 落盘前做**子串替换**：长度 ≥ 4 的请求明文（current/password/code）
 * 逐段换成 `[redacted]`，其余运维上下文原样保留（整段打码会把
 * `users file is locked by another process` 这类无关信息一起吞掉，N2）。
 * 1-3 字符的短 secret 不参与替换：它们几乎必然误伤正常文案，且单独出现不构成泄漏。
 */
function safeError(error, secrets) {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of secrets) {
        if (secret.length >= 4)
            message = message.split(secret).join("[redacted]");
    }
    return message;
}
/** 415/413 响应（M19 复刻：413 先写 `connection: close`，不调 req.destroy）；无 status 的异常向上抛。 */
function respondFormError(res, error) {
    const failed = error;
    if (typeof failed.status !== "number")
        throw error;
    res.setHeader("cache-control", "no-store");
    if (failed.status === 413)
        res.setHeader("connection", "close");
    res.writeHead(failed.status, { "content-type": "text/plain" });
    res.end(failed.message ?? "bad request");
}
/** JSON 写出：no-store 必须早于 writeHead（headers sent 之后 setHeader 会抛）。 */
function sendJson(res, status, body) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}
//# sourceMappingURL=password-change.js.map