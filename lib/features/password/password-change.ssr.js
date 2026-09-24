import { parseCookieHeader } from "../../shared/index.js";
import { buildSetCookie } from "../../session/index.js";
import { queryOf } from "../../http/index.js";
import { PASSWORD_CHANGED_NOTICE, resolveLoginNotice } from "./login-notice.js";
/**
 * 改密端点（`/auth/password`）的 SSR 页面与响应整形（P2 §1/§3/§6）。
 *
 * 与 `password-change.ts` 分文件的原因：后者已经贴着 250 行门禁，P2 的
 * 「页面渲染 + nav 协商 + 响应写出」全部落在这里，`password-change.ts` 只留
 * POST 处理顺序与 method 分发。`sendJson` / `sendUnavailable` / `respondFormError`
 * 是 P1 的三个叶子写出函数，为腾出门禁行数一并下移（纯搬家，行为不变）。
 * 本模块不持有任何业务写路径。
 *
 * 自足性硬约束（受限会话进不了宿主 UI，页面白屏 = 生产锁死）：
 * 零外链（CSS 全内联、无字体/无 url()）、无 `<script>`、不回填任何口令 value。
 * 页面文案与 Location 全部是服务端常量，绝不拼接请求文本（无反射面/无开放重定向面）。
 */
/** 改密页与登录页的固定路径：Location 只用这两个常量。 */
export const PASSWORD_CHANGE_PATH = "/auth/password";
export const LOGIN_PATH = "/auth/login";
/**
 * SSR 页最小样式：全内联、零第三方资源、零外链（无 url()/无 @import/无外部字体），
 * 深浅色自适应。视觉语言与登录页（shared/login-page-assets.ts）同族，但此处不
 * import 它：cross-slice 只能走 shared barrel，而 barrel 不导出该常量。
 */
const PAGE_CSS = `*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:light dark;--bg:#eaedf2;--surface:#f6f7fa;--ink:#1b1e24;--muted:#5c6370;--line:#d3d8e2;--field:#fff;--focus:#3d5a6c;--ring:rgba(61,90,108,.28);--btn:#1b1e24;--btn-ink:#f6f7fa;--notice:#eef2f5}
@media (prefers-color-scheme:dark){:root{--bg:#0c0d10;--surface:#1c1e24;--ink:#eeeef1;--muted:#9aa1ad;--line:#2e323c;--field:#14161b;--focus:#8aa4b3;--ring:rgba(138,164,179,.32);--btn:#e8e9ed;--btn-ink:#1b1e24;--notice:#191b21}}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:400 15px/22px system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:24rem;padding:28px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
.kicker{margin:0;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--focus)}
h1{margin:6px 0 0;font-size:22px;font-weight:700;line-height:28px}
.hint{margin:8px 0 0;font-size:13px;line-height:20px;color:var(--muted)}
.notice{margin:14px 0 0;padding:8px 12px;border-left:3px solid var(--focus);background:var(--notice);font-size:13px;line-height:20px}
form{margin-top:18px}
.field{margin-top:14px}
label{display:block;margin-bottom:6px;font-size:12px;font-weight:500;line-height:18px;color:var(--muted)}
input{width:100%;height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--ink);font-family:inherit;font-size:16px;line-height:22px;outline:none}
input:focus-visible{border-color:var(--focus);box-shadow:0 0 0 3px var(--ring)}
button{width:100%;height:44px;margin-top:18px;border:0;border-radius:10px;background:var(--btn);color:var(--btn-ink);font-family:inherit;font-size:15px;font-weight:600;line-height:22px;cursor:pointer}`;
/**
 * 自足改密页 HTML：唯一表单（POST /auth/password），隐藏字段 `nav=1` 让成功走 302
 * 而非 JSON；`current/password/confirm/code` 四字段**无一回填 value**（hidden 的
 * nav 是契约要求，属唯一例外）。无 `<script>`，页面不依赖任何 JS 也能提交。
 */
export function passwordChangePageHtml(notice) {
    const noticeHtml = notice === undefined || notice === "" ? "" : `<p class="notice" role="status">${notice}</p>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Change password</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="card">
<header>
<p class="kicker">Authentication gate</p>
<h1>Change password</h1>
<p class="hint">Set a new password to continue. This device is signed in with a temporary session.</p>
</header>
${noticeHtml}
<form method="post" action="${PASSWORD_CHANGE_PATH}">
<input type="hidden" name="nav" value="1">
<div class="field">
<label for="current">Current password</label>
<input id="current" name="current" type="password" autocomplete="current-password" required>
</div>
<div class="field">
<label for="password">New password</label>
<input id="password" name="password" type="password" autocomplete="new-password" required>
</div>
<div class="field">
<label for="confirm">Confirm new password</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password" required>
</div>
<div class="field">
<label for="code">Verification code</label>
<input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="Only if two-factor is enabled">
</div>
<p class="hint">At least 14 characters, including an uppercase letter, a lowercase letter, a digit and a special character.</p>
<button type="submit">Change password</button>
</form>
</main>
</body>
</html>
`;
}
/** cookie-only 会话探测（与 POST 同语义：Bearer 不参与）。 */
function hasSession(deps, req) {
    const store = deps.sessions();
    const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
    if (store === undefined || token === undefined || token === "")
        return false;
    return store.getByToken(token) !== undefined;
}
/** 302 写出：Location 只允许本文件的常量（站内相对路径）。 */
function redirect(res, location) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("location", location);
    res.writeHead(302);
    res.end();
}
/**
 * `GET /auth/password`：有会话（full 或 restricted）→ 200 自足表单；
 * 未认证 → `302 /auth/login?next=/auth/password`（唯一语义：不渲染登录页、不 401，
 * 否则受限闭环会断）。token 模式不注册本路由（注册在 password 模式的 endpoints 里）。
 */
export function handlePasswordChangePage(deps, req, res) {
    if (!hasSession(deps, req)) {
        redirect(res, `${LOGIN_PATH}?next=${PASSWORD_CHANGE_PATH}`);
        return;
    }
    res.setHeader("cache-control", "no-store");
    res.setHeader("pragma", "no-cache");
    res.setHeader("referrer-policy", "no-referrer");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(passwordChangePageHtml(resolveLoginNotice(queryOf(req).get("notice"))));
}
/**
 * 改密成功响应整形：`nav=1`（SSR 无 JS 表单）→ `302 /auth/login?notice=password-changed`，
 * 否则保持 P1 的 `200 {"ok":true}`（面板 fetch 的判定绝不依赖 `Accept` 子串）。
 * set-cookie 必须早于 writeHead。
 */
export function respondChanged(deps, res, navigation) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", buildSetCookie(deps.cookieName, "", 0, deps.cookieSecure));
    if (navigation) {
        res.setHeader("pragma", "no-cache");
        res.writeHead(302, { location: `${LOGIN_PATH}?notice=${PASSWORD_CHANGED_NOTICE}` });
        res.end();
        return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
}
/** JSON 写出：no-store 必须早于 writeHead（headers sent 之后 setHeader 会抛）。 */
export function sendJson(res, status, body) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}
/** 503 统一写出（users 文件读/写失败语义）。 */
export function sendUnavailable(res) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("password change unavailable");
}
/** 415/413 响应（M19 复刻：413 先写 `connection: close`，不调 req.destroy）；无 status 的异常向上抛。 */
export function respondFormError(res, error) {
    const failed = error;
    if (typeof failed.status !== "number")
        throw error;
    res.setHeader("cache-control", "no-store");
    if (failed.status === 413)
        res.setHeader("connection", "close");
    res.writeHead(failed.status, { "content-type": "text/plain" });
    res.end(failed.message ?? "bad request");
}
//# sourceMappingURL=password-change.ssr.js.map