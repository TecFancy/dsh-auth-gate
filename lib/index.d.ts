import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { Gate } from "./gate.js";
import { SessionStore } from "./session-store.js";
/** 稳定 Cordis 插件名（host 组合行 id）。 */
export declare const name = "dsh-auth-gate";
/** 硬依赖：守卫包装 webServer 的路由表；storageDomain/credentials 软读（见 apply）。 */
export declare const inject: readonly ["webServer"];
export interface AuthConfig {
    /** 认证流：token（M2）/ password（M3）。 */
    mode: "token" | "password";
    /** 会话 TTL（秒）。 */
    sessionTtl: number;
    /** 会话 cookie 名。 */
    cookieName: string;
    /** 共享 token 的 credentials 引用名（环境变量名）；password 模式忽略。 */
    tokenRef: string;
    /** cookie 是否带 `; Secure`（http 测试/开发可关，M7）。 */
    cookieSecure: boolean;
    /** users.yaml 路径；`""` = 按 P6 解析默认路径。password 模式专用。 */
    usersFile: string;
    /**
     * 「退出登录」按钮在设置 → 通用设置 页的槽位 order（升序渲染，越大越靠底部）。
     * 默认 1000 已大于 dsh 自带条目（-25~20）与绝大多数第三方插件；如确有插件
     * 注册更大的 order，可在此显式调大。经 `/auth/status` 透传给 client 半边。
     */
    logoutOrder: number;
}
export declare const Config: z<AuthConfig>;
/** 本插件提供的 auth 服务：门（可换流/测试注入）+ 会话层。 */
export interface AuthService {
    /** storageDomain 缺失时为 undefined（会话不可用但守卫照常挂载）。 */
    sessions: SessionStore | undefined;
    /** 可写：token 模式为 TokenGate、password 模式为 PasswordGate；测试注入假门。 */
    gate: Gate;
}
declare module "@deepseek-ai/cordis" {
    interface Context {
        auth?: AuthService;
    }
}
/**
 * 应用 auth 门：mode 分支（token: credentials 解析器 + TokenGate；password: PasswordGate +
 * usersPath + 限速器）→ auth 服务（一步成型，sessions 访问器闭包自引用 auth）→ 软接会话层 →
 * 包装 webServer 四类入口 → 注册 /auth 端点（按 mode 二选一）→ 启动自检（fail loud）。
 * apply 内无 await；password 模式不访问 credentials 服务。
 */
export declare function apply(ctx: Context, config: AuthConfig): void;
//# sourceMappingURL=index.d.ts.map