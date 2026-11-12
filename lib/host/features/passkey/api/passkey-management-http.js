import { checkRequestOrigin, parseCookieHeader, setPasskeyPermissionsPolicy, } from "../../../shared/http/index.js";
/** 再认证失败的唯一常量文案（只进日志，不进响应）。 */
export const REAUTH_FAILED = "re-authentication failed";
/** JSON 写出：`no-store` + `Permissions-Policy` 必须在 `writeHead` 之前。 */
export function sendPasskeyJson(res, status, body) {
    res.setHeader("cache-control", "no-store");
    setPasskeyPermissionsPolicy(res);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}
/** 错误体快捷方式（`reason` 只用于 400 的细分，如 `last-credential`）。 */
export function sendPasskeyError(res, status, error, reason) {
    const body = reason === undefined ? { error } : { error, reason };
    sendPasskeyJson(res, status, body);
}
/** 503 纯文本（与口令登录同形；读盘失败不计失败、不消费 ceremony）。 */
export function sendPasskeyStoreUnavailable(res) {
    res.setHeader("cache-control", "no-store");
    setPasskeyPermissionsPolicy(res);
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("user store unavailable");
}
/** 415/413（与既有端点同形：413 先写 `connection: close`）；无 status 的异常向上抛。 */
export function respondPasskeyFormError(res, error) {
    const failed = error;
    if (typeof failed.status !== "number")
        throw error;
    res.setHeader("cache-control", "no-store");
    setPasskeyPermissionsPolicy(res);
    if (failed.status === 413)
        res.setHeader("connection", "close");
    res.writeHead(failed.status, { "content-type": "text/plain" });
    res.end(failed.message ?? "bad request");
}
/** 只认 cookie 的会话定位（Bearer 不参与，与 `/auth/status` 同口径）。 */
export function locatePasskeySession(deps, req) {
    const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
    if (token === undefined || token === "")
        return { kind: "no-cookie" };
    const store = deps.sessions();
    if (store === undefined)
        return { kind: "unavailable" };
    const session = store.getByToken(token);
    return session === undefined ? { kind: "no-cookie" } : { kind: "session", session };
}
/** 受限会话（`password-change-only`）与 bootstrap 会话一律不得进管理面。 */
export function isRestrictedSession(session) {
    return session.kind === "password-change-only" || session.kind === "bootstrap";
}
/** 同源校验（fail-closed：`publicHost` 未配置时只信 `Sec-Fetch-Site`）。 */
export function passkeyOriginAccepted(deps, req) {
    return checkRequestOrigin(originRequest(req), deps.publicHost).ok;
}
/** `OriginCheckRequest` 结构适配：TLS 标记只存在于 `TLSSocket`，这里现取一次布尔值。 */
function originRequest(req) {
    return { headers: req.headers, socket: { encrypted: isEncrypted(req.socket) } };
}
function isEncrypted(socket) {
    return "encrypted" in socket && socket.encrypted === true;
}
/** 现读 users.yaml；失败 → 503 + error 日志（不计失败）。 */
export async function loadPasskeyUsersOr503(deps, res) {
    try {
        return await deps.loadUsers();
    }
    catch (error) {
        deps.logger.error(`passkey user store unavailable: ${error instanceof Error ? error.message : String(error)}`);
        sendPasskeyStoreUnavailable(res);
        return undefined;
    }
}
/**
 * 会话 → 已认证上下文：会话有效但账号已不在 users.yaml / 已禁用 → 401（与「会话无效」同形，
 * 不泄漏账号是否存在）。
 */
export function authedRequest(session, loaded) {
    const user = loaded.snapshot.users.get(session.subject);
    if (user === undefined || user.disabled === true)
        return undefined;
    return { session, username: session.subject, user, snapshot: loaded.snapshot };
}
/** 时钟：deps 未注入时用 `Date.now`（测试注入固定时钟）。 */
export function nowOf(deps) {
    return deps.now ?? Date.now;
}
/**
 * 再认证（§5.7）：口令必须匹配；`totpMode !== "off"` 且用户有 secret 时验证码必须通过
 * 校验与防重放。任何一项失败都返回 false（调用方回同一个 401，原因只进日志）。
 */
export async function reauthenticate(deps, username, user, input) {
    const passwordOk = await deps.management.verify(input.password, user.passwordHash);
    if (!passwordOk)
        return false;
    if (deps.totpMode === "off" || user.totpSecret === undefined)
        return true;
    const counter = deps.management.verifyTotp(user.totpSecret, input.code, nowOf(deps)());
    if (counter === undefined)
        return false;
    return deps.management.replayCheck(username, counter, input.code);
}
//# sourceMappingURL=passkey-management-http.js.map