import { lockoutMessage, passkeyOnlyLoginPageHtml, passwordLoginPageHtml, totpChallengePageHtml, } from "../../../shared/login-page/index.js";
import { setPasskeyPermissionsPolicy } from "../../../shared/http/index.js";
import { loginPath } from "../../../shared/protocol/index.js";
/** 未知用户 / 错口令 / 禁用三态共用的唯一常量（P9 反枚举）。 */
export const INVALID_CREDENTIALS = "Invalid username or password.";
/**
 * 口令登录被策略关闭时的唯一常量（`passkey: "required"`）。不复用 `INVALID_CREDENTIALS`：
 * 这里凭据可能完全正确，说「用户名或密码错」会把用户引向改密码这条死路。
 */
export const PASSKEY_ONLY_DISABLED_TEXT = "This instance requires a passkey. Password sign-in is disabled.";
/**
 * TOTP 第二段拒绝的唯一常量（D21）：错码、重放码、账号已无 secret 三态共用。
 * 不复用 `INVALID_CREDENTIALS`：走到这一步口令是对的，说「用户名或密码错」会指向错误的
 * 手因；也不能细分重放/过期/漂移，否则等于给攻击者一个反馈探针。
 */
export const INVALID_TOTP_CODE = "Invalid or expired code.";
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
/**
 * 403 口令登录已被策略关闭（`passkey: "required"`，issue #133）：渲染 passkey-only 卡片。
 *
 * 状态码取 403 而不是 401：凭据可能完全正确，拒绝的理由是策略而不是身份，401 会误导客户端
 * 去重试。响应与输入无关（不读用户名、不读密码、不读挑战 cookie），因此没有枚举侧信道。
 */
export function sendPasswordLoginDisabled(res, ctx) {
    sendHtml(res, 403, passkeyOnlyLoginPageHtml(ctx.next, PASSKEY_ONLY_DISABLED_TEXT, { host: ctx.host }));
}
/** 统一写出：no-store 必须在 writeHead 之前（headers sent 之后再 setHeader 会抛 ERR_HTTP_HEADERS_SENT）。 */
function sendHtml(res, status, html) {
    res.setHeader("cache-control", "no-store");
    setPasskeyPermissionsPolicy(res);
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
}
