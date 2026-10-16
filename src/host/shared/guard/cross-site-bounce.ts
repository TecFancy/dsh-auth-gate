import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 跨站顶层导航判定：GET + `Sec-Fetch-Site: cross-site` + `Sec-Fetch-Dest: document`。
 * 只认顶层文档（iframe 的 dest 是 `iframe`，不触发）；任一头缺失 → false，保持放行原行为。
 * `same-site` / `same-origin` / `none` 一律 false，所以弹回后的第二次请求不会再命中（无循环）。
 */
export function isCrossSiteDocumentNavigation(req: IncomingMessage): boolean {
  if (req.method !== "GET") return false;
  const site = req.headers["sec-fetch-site"];
  const dest = req.headers["sec-fetch-dest"];
  return (
    typeof site === "string" &&
    site.toLowerCase() === "cross-site" &&
    typeof dest === "string" &&
    dest.toLowerCase() === "document"
  );
}

/** 内联脚本原文：CSP 哈希由它算出，两者不会漂移。不含任何请求数据。 */
const BOUNCE_SCRIPT = "location.replace(location.href)";

const BOUNCE_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${createHash("sha256").update(BOUNCE_SCRIPT).digest("base64")}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** 页面是静态常量：不插值 URL 或任何请求数据（无反射、无 XSS 面）；`href=""` 即当前 URL。 */
const BOUNCE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  "<title>Continue</title></head><body>" +
  `<script>${BOUNCE_SCRIPT}</script>` +
  '<noscript><a href="">Continue</a></noscript></body></html>';

/**
 * 回一张同源弹回页，让浏览器用同源文档重新导航到当前 URL（调用方保证 gate 已放行）。
 *
 * 外层 `dsh_auth` 是 `SameSite=Lax`，dsh 自带的内层 cookie 是 `SameSite=Strict`：跨站顶层
 * 导航（别的站点点链接、127.0.0.1 → localhost）只带前者，dsh 会回 401；刷新沿用原来的跨站
 * 上下文，所以 F5 修不好。同源文档发起的导航属于同站，Strict cookie 随第二次请求送出；
 * 第二次请求的 `Sec-Fetch-Site` 是 `same-origin`，不再命中判定，因此不会循环。
 * `/?token=` 这类 URL 可能带 dsh 的 launch token，故 `referrer-policy: no-referrer`。
 */
export function serveCrossSiteBounce(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": BOUNCE_CSP,
  });
  res.end(BOUNCE_HTML);
}
