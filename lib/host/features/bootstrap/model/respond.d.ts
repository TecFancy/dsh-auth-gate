import type { ServerResponse } from "node:http";
/**
 * 首次引导三个端点的响应小件：一律 `no-store`；重定向一律带 `referrer-policy: no-referrer`
 * （被拒的 URL 里可能带着 dsh 的 launch token，不能让浏览器把它当 Referer 传给下一跳）。
 */
/** 302 到登录页（`next=/`）：所有失败分支唯一的去处（fail-closed）。 */
export declare function redirectToLogin(res: ServerResponse): void;
/** 302 到站内相对地址，禁缓存、禁 Referer。 */
export declare function redirectTo(res: ServerResponse, location: string): void;
/** 渲染 HTML（禁缓存、禁 Referer：与三条重定向出口保持同一纪律）。 */
export declare function sendHtml(res: ServerResponse, status: number, html: string): void;
/** 纯文本拒绝（禁缓存）：固定句子，绝不回显请求内容。 */
export declare function sendText(res: ServerResponse, status: number, body: string, headers?: Record<string, string>): void;
//# sourceMappingURL=respond.d.ts.map