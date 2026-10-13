import type { IncomingMessage, ServerResponse } from "node:http";
/**
 * 跨站顶层导航判定：GET + `Sec-Fetch-Site: cross-site` + `Sec-Fetch-Dest: document`。
 * 只认顶层文档（iframe 的 dest 是 `iframe`，不触发）；任一头缺失 → false，保持放行原行为。
 * `same-site` / `same-origin` / `none` 一律 false，所以弹回后的第二次请求不会再命中（无循环）。
 */
export declare function isCrossSiteDocumentNavigation(req: IncomingMessage): boolean;
/**
 * 回一张同源弹回页，让浏览器用同源文档重新导航到当前 URL（调用方保证 gate 已放行）。
 *
 * 外层 `dsh_auth` 是 `SameSite=Lax`，dsh 自带的内层 cookie 是 `SameSite=Strict`：跨站顶层
 * 导航（别的站点点链接、127.0.0.1 → localhost）只带前者，dsh 会回 401；刷新沿用原来的跨站
 * 上下文，所以 F5 修不好。同源文档发起的导航属于同站，Strict cookie 随第二次请求送出；
 * 第二次请求的 `Sec-Fetch-Site` 是 `same-origin`，不再命中判定，因此不会循环。
 * `/?token=` 这类 URL 可能带 dsh 的 launch token，故 `referrer-policy: no-referrer`。
 */
export declare function serveCrossSiteBounce(res: ServerResponse): void;
//# sourceMappingURL=cross-site-bounce.d.ts.map