import { loginPath } from "../../../shared/protocol/index.js";
/**
 * 首次引导三个端点的响应小件：一律 `no-store`；重定向一律带 `referrer-policy: no-referrer`
 * （被拒的 URL 里可能带着 dsh 的 launch token，不能让浏览器把它当 Referer 传给下一跳）。
 */
/** 302 到登录页（`next=/`）：所有失败分支唯一的去处（fail-closed）。 */
export function redirectToLogin(res) {
    redirectTo(res, loginPath("/"));
}
/** 302 到站内相对地址，禁缓存、禁 Referer。 */
export function redirectTo(res, location) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.writeHead(302, { location });
    res.end();
}
/** 渲染 HTML（禁缓存、禁 Referer：与三条重定向出口保持同一纪律）。 */
export function sendHtml(res, status, html) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
}
/** 纯文本拒绝（禁缓存）：固定句子，绝不回显请求内容。 */
export function sendText(res, status, body, headers = {}) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(status, { "content-type": "text/plain", ...headers });
    res.end(body);
}
//# sourceMappingURL=respond.js.map