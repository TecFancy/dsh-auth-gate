import type { IncomingMessage, ServerResponse } from "node:http";
/**
 * 认证 HTTP 端点公共件的纯 HTTP 半边（D29：`shared/http` 段）。
 *
 * 本文件只放与会话无关的纯 HTTP 小件（404 兜底、405、query 解析），
 * 不 import 会话实体，也不 import 任何 users 相关件。
 * 依赖会话的 logout / status 端点在 `entities/session/api/session-endpoints.ts`。
 */
/** 兜底：未注册的 `/auth/*` 一律 404，不落到 SPA fallback（M20）。 */
export declare function authCatchAll(_req: IncomingMessage, res: ServerResponse): void;
/** 只取 query（M22：logout 的 next 不走 body），node:http 无内置 req.query。 */
export declare function queryOf(req: IncomingMessage): URLSearchParams;
export declare function methodNotAllowed(res: ServerResponse, allow: string): void;
//# sourceMappingURL=endpoints.d.ts.map