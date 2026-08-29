import { type HttpHandler } from "./guard.js";
import { type SessionStore } from "./session-store.js";
export interface AuthEndpointsDeps {
    /** 注册路由（index.ts 传入包装后的 server.register；被守卫包装但被 gate 白名单放行）。 */
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: HttpHandler;
    }): () => void;
    /** 会话访问器（M16）：domain 异步就绪，端点内每次现取。 */
    sessions: () => SessionStore | undefined;
    cookieName: string;
    cookieSecure: boolean;
    sessionTtl: number;
    /** 「退出登录」按钮在通用设置页的槽位 order（经 /auth/status 透传 client）。 */
    logoutOrder: number;
    validateToken: (token: string) => Promise<boolean>;
    logger: {
        error(message: unknown): void;
        info(message: unknown): void;
    };
}
/**
 * 注册 prefix `/auth` 兜底 + 三个 exact 端点（M15：webserver 无 method 路由，exact
 * 表只按 pathname 建键、重复 path 抛错，故 GET/POST `/auth/login` 不能注册两条路由，
 * 由 handler 内部按 `req.method` 分发）。返回合并 disposer（内部收集每个 register 的
 * disposer）。
 */
export declare function registerAuthEndpoints(deps: AuthEndpointsDeps): () => void;
//# sourceMappingURL=auth-endpoints.d.ts.map