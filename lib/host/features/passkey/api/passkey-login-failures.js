import { passwordLoginPageHtml } from "../../../shared/login-page/index.js";
/** 401 的唯一常量文案：未知凭据与各类校验失败共用。 */
export const PASSKEY_LOGIN_FAILED_MESSAGE = "Passkey sign-in failed. Try again or use your password.";
/** 429 固定文案（不插值秒数）：只陈述「这个网络」被限速。 */
export const PASSKEY_LOGIN_LOCKED_MESSAGE = "Too many sign-in attempts from this network. Try again later.";
/**
 * 失败卡片上的 passkey 重试入口：条件 UI 只属于登录页首屏（失败卡重试不需要 autofill），
 * 因此恒传 `conditionalUi: false`；没有它的话 401 卡片只剩口令表单，passkey 用户要多点一次。
 */
const RETRY_PASSKEY = { enabled: true, conditionalUi: false };
/** 401：登录卡片（error slot）并清掉已消费的 ceremony cookie（无会话 cookie）。 */
export function sendPasskeyFailure(res, context, clearCeremonyCookie) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", clearCeremonyCookie);
    res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
    res.end(passwordLoginPageHtml(context.next, PASSKEY_LOGIN_FAILED_MESSAGE, {
        host: context.host,
        passkey: RETRY_PASSKEY,
    }));
}
/** 429：同一张卡片 + 固定锁定文案 + `retry-after`（不显示剩余次数）。 */
export function sendPasskeyLocked(res, context, retryAfterSeconds) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("retry-after", String(retryAfterSeconds));
    res.writeHead(429, { "content-type": "text/html; charset=utf-8" });
    res.end(passwordLoginPageHtml(context.next, PASSKEY_LOGIN_LOCKED_MESSAGE, {
        host: context.host,
        passkey: RETRY_PASSKEY,
    }));
}
/** options 端点的 429（fetch 路径）：JSON 错误体 + `retry-after` 头，不下发 ceremony cookie。 */
export function sendOptionsLocked(res, retryAfterSeconds) {
    const body = { error: "locked", retryAfter: retryAfterSeconds };
    res.setHeader("cache-control", "no-store");
    res.setHeader("retry-after", String(retryAfterSeconds));
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}
/** 503：会话存储未就绪（与口令登录同形：text/plain，不计失败、不消费 ceremony）。 */
export function sendPasskeyUnavailable(res) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("session store unavailable");
}
//# sourceMappingURL=passkey-login-failures.js.map