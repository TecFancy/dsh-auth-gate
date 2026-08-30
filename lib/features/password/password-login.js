import { validateNext, parseFormBody, parseCookieHeader } from "../../shared/index.js";
import { DUMMY_HASH } from "./password.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { buildSetCookie } from "../../session/index.js";
/** TOTP 挑战 cookie 名（M4 T5）。 */
export const CHALLENGE_COOKIE = "dsh_auth_challenge";
/** 挑战 cookie 有效期（秒，M4 T5 模块常量）。 */
export const CHALLENGE_TTL_SECONDS = 300;
/** 挑战 cookie 值格式 `<username>.<expiresEpochMs>`（username 字符集不含 `.`）。 */
export function buildChallengeValue(username, expiresEpochMs) {
    return `${username}.${expiresEpochMs}`;
}
/** 解析挑战 cookie 值；格式非法/过期/时间戳异常 → undefined。 */
export function parseChallengeValue(value, nowMs) {
    if (value === undefined)
        return undefined;
    const dot = value.lastIndexOf(".");
    if (dot <= 0 || dot === value.length - 1)
        return undefined;
    const username = value.slice(0, dot);
    const expires = Number(value.slice(dot + 1));
    if (!Number.isInteger(expires) ||
        expires <= nowMs ||
        expires - nowMs > CHALLENGE_TTL_SECONDS * 1000) {
        return undefined;
    }
    return username;
}
/** 文件缺失告警只触发一次（插件单实例，等价进程级一次，P7）。 */
let warnedMissing = false;
/**
 * POST /auth/login（password 模式，P14 + M4 T6）。完成全部响应写出（415/413/401/429/503/302）。
 * 流程顺序冻结：body → 挑战 cookie 分流 → 限速 → 用户文件 → 恒时验证 → 会话/挑战。
 * 挑战提交路径（有合法挑战 cookie + body 含 code）：验证 TOTP → 发会话；
 * 否则走密码路径：验证通过后按 totpMode 决定直接发会话或发挑战 cookie。
 * 不吞不带 `status` 的流异常。
 */
export async function handlePasswordLogin(deps, req, res) {
    let params;
    try {
        params = await parseFormBody(req);
    }
    catch (error) {
        respondFormError(res, error);
        return;
    }
    const next = validateNext(params.get("next") ?? "/");
    const ip = req.socket.remoteAddress ?? "";
    const challenge = parseChallengeValue(parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE), deps.now());
    const code = params.get("code") ?? "";
    if (challenge !== undefined && code !== "") {
        await handleTotpSubmit(deps, res, challenge, code, next, ip);
        return;
    }
    await handlePasswordSubmit(deps, res, params, next, ip);
}
/** TOTP 挑战提交：限速 → 用户文件 → 恒时验证 → 防重放 → 发会话。 */
async function handleTotpSubmit(deps, res, username, code, next, ip) {
    if (!rateLimitOk(deps, res, ip, username))
        return;
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    const user = loaded.snapshot.users.get(username);
    if (user?.totpSecret === undefined) {
        deps.limiter.recordFailure(ip, username);
        res.setHeader("cache-control", "no-store");
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("invalid credentials");
        deps.logger.info("login rejected");
        return;
    }
    const matched = deps.verifyTotp(user.totpSecret, code, deps.now());
    const replay = matched !== undefined && deps.replayCheck(username, matched, code);
    if (matched === undefined || !replay) {
        deps.limiter.recordFailure(ip, username);
        res.setHeader("cache-control", "no-store");
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("invalid credentials");
        deps.logger.info("login rejected");
        return;
    }
    deps.limiter.recordSuccess(ip, username);
    const store = deps.sessions();
    if (store === undefined) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("session store unavailable");
        deps.logger.error("login failed: session store unavailable");
        return;
    }
    // 清挑战 cookie + 发正式会话（M4 T6：一次性，防重放再收窄）；set-cookie 用数组
    // （Node 重复 setHeader 会覆盖，必须同一次写两个 cookie）
    await issueSession(deps, res, store, username, next, [
        buildSetCookie(CHALLENGE_COOKIE, "", 0, deps.cookieSecure),
    ]);
}
/** 密码提交：限速 → 用户文件 → 恒时验证 → 按 totpMode 发会话或发挑战 cookie。 */
async function handlePasswordSubmit(deps, res, params, next, ip) {
    const username = params.get("username") ?? "";
    const password = params.get("password") ?? "";
    const accountKey = username === "" ? undefined : username;
    if (!rateLimitOk(deps, res, ip, accountKey))
        return;
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return; // 系统错误不计失败
    if (await rejectedInvalid(deps, res, loaded, username, password, ip, accountKey))
        return;
    deps.limiter.recordSuccess(ip, accountKey); // P10：验证通过即清零失败桶（spec §4.7 步骤 7）
    const user = loaded.snapshot.users.get(username);
    const needsTotp = user?.totpSecret !== undefined && deps.totpMode !== "off";
    if (deps.totpMode === "required" && user?.totpSecret === undefined) {
        // required 模式：无 secret 的用户（含未知用户）统一 401（防枚举，与密码错误同响应）
        deps.limiter.recordFailure(ip, accountKey);
        res.setHeader("cache-control", "no-store");
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("invalid credentials");
        deps.logger.info("login rejected");
        return;
    }
    if (needsTotp) {
        // 两段式第一段通过：发挑战 cookie，302 回挑战页（GET 渲染 TOTP 输入）
        const expires = deps.now() + CHALLENGE_TTL_SECONDS * 1000;
        res.setHeader("cache-control", "no-store");
        res.setHeader("set-cookie", buildSetCookie(CHALLENGE_COOKIE, buildChallengeValue(username, expires), CHALLENGE_TTL_SECONDS, deps.cookieSecure));
        res.writeHead(302, { location: `/auth/login?next=${encodeURIComponent(next)}` });
        res.end();
        return;
    }
    const store = deps.sessions();
    if (store === undefined) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("session store unavailable");
        deps.logger.error("login failed: session store unavailable");
        return;
    }
    await issueSession(deps, res, store, username, next);
}
/** 读取用户文件；失败 → 503 + error 日志并返回 undefined（不计失败）。 */
async function loadUsersOr503(deps, res) {
    try {
        return await deps.loadUsers();
    }
    catch (error) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("user store unavailable");
        deps.logger.error(`user store unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}
/** 恒时验证 + 拒绝路径（P9：未知/错口令/禁用统一 401 + 计失败）；返回是否已拒绝。 */
async function rejectedInvalid(deps, res, loaded, username, password, ip, accountKey) {
    if (loaded.missing && !warnedMissing) {
        warnedMissing = true;
        deps.logger.warn(`users file not found: ${deps.usersPath} (all password logins rejected)`);
    }
    const user = loaded.snapshot.users.get(username);
    const ok = await deps.verify(password, user?.passwordHash ?? DUMMY_HASH);
    if (ok && user !== undefined && !user.disabled)
        return false;
    deps.limiter.recordFailure(ip, accountKey);
    res.setHeader("cache-control", "no-store");
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("invalid credentials");
    deps.logger.info("login rejected");
    return true;
}
/** 限速门（P10）：锁定 → 429 + retry-after，不验证、不增计数。返回是否放行。 */
function rateLimitOk(deps, res, ip, accountKey) {
    const check = deps.limiter.check(ip, accountKey);
    if (check.allowed)
        return true;
    res.setHeader("cache-control", "no-store");
    res.setHeader("retry-after", String(check.retryAfterSeconds));
    res.writeHead(429, { "content-type": "text/plain" });
    res.end("too many attempts");
    deps.logger.info("rate limit exceeded");
    return false;
}
/** 发会话（P14）：subject=username，每次登录新会话；成功 → 302 + set-cookie。 */
async function issueSession(deps, res, store, username, next, extraSetCookie) {
    const { token: sessionToken } = await store.create(username, deps.sessionTtl * 1000);
    res.setHeader("cache-control", "no-store");
    const cookies = [
        ...(extraSetCookie ?? []),
        buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure),
    ];
    res.setHeader("set-cookie", cookies);
    res.writeHead(302, { location: next });
    res.end();
    deps.logger.info("session issued");
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
//# sourceMappingURL=password-login.js.map