import type { IncomingMessage, ServerResponse } from "node:http";
import { type SessionStore } from "../session/index.js";
/**
 * token 与 password 两个认证面共用的端点件（核心机制层 http/，与 gate、session 并列）。
 *
 * 两个认证面的 deps 结构上都满足 `AuthHttpDeps`：这里只声明本模块真实需要的字段，
 * 不依赖任何一方的完整 deps 形状，也不 import 任何 features/ slice。
 */
export interface AuthHttpDeps {
    /** 会话访问器（M16：domain 异步就绪，端点内每次现取；undefined = 会话通道不可用）。 */
    readonly sessions: () => SessionStore | undefined;
    readonly cookieName: string;
    readonly cookieSecure: boolean;
    /** 「退出登录」按钮在通用设置页的槽位 order（经 /auth/status 透传 client）。 */
    readonly logoutOrder: number;
    readonly logger: {
        info(message: unknown): void;
    };
}
/** 兜底：未注册的 `/auth/*` 一律 404，不落到 SPA fallback（M20）。 */
export declare function authCatchAll(_req: IncomingMessage, res: ServerResponse): void;
/** POST /auth/logout 路由入口：非 POST 405，其余交给 logout。 */
export declare function handleLogout(deps: AuthHttpDeps, req: IncomingMessage, res: ServerResponse): void | Promise<void>;
/** GET /auth/status：只认 cookie（M5，Bearer 不参与）。 */
export declare function handleStatus(deps: AuthHttpDeps, req: IncomingMessage, res: ServerResponse): void;
/** 只取 query（M22：logout 的 next 不走 body），node:http 无内置 req.query。 */
export declare function queryOf(req: IncomingMessage): URLSearchParams;
export declare function methodNotAllowed(res: ServerResponse, allow: string): void;
//# sourceMappingURL=endpoints.d.ts.map