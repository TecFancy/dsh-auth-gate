import { type HttpHandler } from "../../gate/index.js";
import { type SessionStore } from "../../session/index.js";
/**
 * 错 token 的唯一常量文案（D21）：所有拒绝共用同一响应形态，且绝不读 query、绝不反射
 * 请求文本（与密码段 `INVALID_CREDENTIALS` / P9 / D20 同一条纪律）。令牌模式只有一个
 * 共享秘密，本就没有账号枚举面，这条规则防的是「用请求内容拼文案」的开放重定向式用法。
 */
export declare const INVALID_TOKEN = "Invalid access token.";
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
    /**
     * 反钓鱼身份块的 host（D14）：配置优先，缺省/空串回退请求头 Host。
     * 半外壳反代（Caddy `header_up Host 127.0.0.1:3080`）下必须显式配置，否则会渲染回环地址。
     */
    publicHost?: string | undefined;
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