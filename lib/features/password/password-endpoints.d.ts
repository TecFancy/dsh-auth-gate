import { type HttpHandler } from "../../gate/index.js";
import { type PasswordLoginDeps } from "./password-login.js";
export interface PasswordEndpointsDeps extends PasswordLoginDeps {
    /** 注册路由（index.ts 传入包装后的 server.register；被守卫包装但被 gate 白名单放行）。 */
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: HttpHandler;
    }): () => void;
    /** 「退出登录」按钮在通用设置页的槽位 order（经 /auth/status 透传 client）。 */
    logoutOrder: number;
}
/**
 * 注册 prefix `/auth` 兜底 + 三个 exact 端点（password 模式，P16）。返回合并 disposer。
 * 路由模型同 M15：webserver 无 method 路由，exact handler 内部按 `req.method` 分发。
 */
export declare function registerPasswordEndpoints(deps: PasswordEndpointsDeps): () => void;
//# sourceMappingURL=password-endpoints.d.ts.map