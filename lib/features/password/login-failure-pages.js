import { loginPath, passwordLoginPageHtml, totpChallengePageHtml } from "../../shared/index.js";
/** 未知用户 / 错口令 / 禁用三态共用的唯一常量（P9 反枚举）。 */
export const INVALID_CREDENTIALS = "Invalid username or password.";
/**
 * 锁定文案（429）：按「这个网络」而非「你的账号」陈述，桶按客户端 IP（#82）时不会指控错人；
 * 不显示剩余次数，也不承诺自助重置（本产品没有）。
 */
export function lockoutMessage(retryAfterSeconds) {
    const unit = retryAfterSeconds === 1 ? "second" : "seconds";
    return ("Too many sign-in attempts from this network. " +
        `Try again in ${retryAfterSeconds} ${unit}. ` +
        "There is no password reset, so ask the instance owner if you are stuck.");
}
/** 401 错凭据：HTML 卡片 + error slot（用户名回填、密码必然为空）。 */
export function sendInvalidCredentials(res, ctx) {
    sendHtml(res, 401, passwordLoginPageHtml(ctx.next, INVALID_CREDENTIALS, {
        host: ctx.host,
        username: ctx.username,
    }));
}
/** 429 密码段：同一张卡片 + 锁定文案（静态秒数；按钮保持可用，无 JS 也能重试）。 */
export function sendLockout(res, ctx, retryAfterSeconds) {
    res.setHeader("retry-after", String(retryAfterSeconds));
    sendHtml(res, 429, passwordLoginPageHtml(ctx.next, lockoutMessage(retryAfterSeconds), {
        host: ctx.host,
        username: ctx.username,
    }));
}
/** 429 TOTP 段：挑战卡 + 锁定文案（挑战 cookie 保留，窗口过后可继续同一账号）。 */
export function sendTotpLockout(res, ctx, retryAfterSeconds) {
    res.setHeader("retry-after", String(retryAfterSeconds));
    sendHtml(res, 429, totpChallengePageHtml(ctx.next, lockoutMessage(retryAfterSeconds), {
        host: ctx.host,
        who: ctx.username,
        resetHref: loginPath(ctx.next, "password"),
    }));
}
/** 统一写出：no-store 必须在 writeHead 之前（headers sent 之后再 setHeader 会抛 ERR_HTTP_HEADERS_SENT）。 */
function sendHtml(res, status, html) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
}
//# sourceMappingURL=login-failure-pages.js.map