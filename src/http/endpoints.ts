import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 认证 HTTP 端点公共件的纯 HTTP 半边（核心机制层 http/，与 gate、session 并列）。
 *
 * D29 拆分：本文件只放与会话无关的纯 HTTP 小件（404 兜底、405、query 解析），
 * 不 import `../session/`，也不 import 任何 users 相关件；D29 落地后整体归入 `shared/http`。
 * 依赖会话的 logout / status 端点在 `session-endpoints.ts`（D29 后归 `entities/session`）。
 */

/** 兜底：未注册的 `/auth/*` 一律 404，不落到 SPA fallback（M20）。 */
export function authCatchAll(_req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("cache-control", "no-store");
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

/** 只取 query（M22：logout 的 next 不走 body），node:http 无内置 req.query。 */
export function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://x").searchParams;
}

export function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader("cache-control", "no-store");
  res.writeHead(405, { allow, "content-type": "text/plain" });
  res.end("method not allowed");
}
