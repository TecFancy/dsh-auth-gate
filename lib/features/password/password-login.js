import { validateNext, parseFormBody } from "../../shared/index.js";
import { DUMMY_HASH } from "./password.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { buildSetCookie } from "../../session/index.js";
/** 文件缺失告警只触发一次（插件单实例，等价进程级一次，P7）。 */
let warnedMissing = false;
/**
 * POST /auth/login（password 模式，P14）。完成全部响应写出（415/413/401/429/503/302）。
 * 流程顺序冻结：body → 限速 → 用户文件 → 恒时验证 → 会话。不吞不带 `status` 的流异常。
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
    const username = params.get("username") ?? "";
    const password = params.get("password") ?? "";
    const next = validateNext(params.get("next") ?? "/");
    const ip = req.socket.remoteAddress ?? "";
    const accountKey = username === "" ? undefined : username;
    if (!rateLimitOk(deps, res, ip, accountKey))
        return;
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return; // 系统错误不计失败
    if (await rejectedInvalid(deps, res, loaded, username, password, ip, accountKey))
        return;
    deps.limiter.recordSuccess(ip, accountKey); // P10：验证通过即清零失败桶（spec §4.7 步骤 7）
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
async function issueSession(deps, res, store, username, next) {
    const { token: sessionToken } = await store.create(username, deps.sessionTtl * 1000);
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure));
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