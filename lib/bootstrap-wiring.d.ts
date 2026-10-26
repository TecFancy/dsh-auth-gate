import type { Context } from "@deepseek-ai/cordis";
import type { WrappableServer } from "./host/shared/guard/index.js";
import type { LaunchTokenBridge } from "./host/shared/http/index.js";
import { type SessionStore } from "./host/entities/session/index.js";
import { type ConfiguredProbe } from "./host/features/bootstrap/index.js";
/** 只看 bootstrap 需要的启动期配置（结构兼容 `AuthConfig`，根文件传整个 config 即可）。 */
export interface BootstrapConfig {
    mode: "token" | "password";
    cookieName: string;
    cookieSecure: boolean;
    sessionTtl: number;
    tokenRef: string;
    publicHost: string;
}
export interface BootstrapWiringInput {
    ctx: Context;
    server: WrappableServer;
    config: BootstrapConfig;
    /** 会话层（异步就绪，每次现取）。 */
    auth: {
        sessions: SessionStore | undefined;
    };
    usersPath: string;
    launchTokenBridge: LaunchTokenBridge;
    log: {
        info(message: unknown): void;
        warn(message: unknown): void;
        error(message: unknown): void;
    };
}
export interface BootstrapWiring {
    /** 注册三条路由（`/auth/bootstrap`、`/auth/setup`、`/auth/continue`），返回合并 disposer。 */
    mount: () => () => void;
    probe: ConfiguredProbe;
    /** 进程内「已配置」标志：向导写入成功后置位，探针立即改口，不等服务端缓存刷新。 */
    markedConfigured: {
        value: boolean;
    };
    /** 会话层就绪后的启动清扫：已配置实例上的残留 bootstrap 会话一律吊销。 */
    onSessionsReady: (store: SessionStore) => void;
}
/**
 * 首次引导通道的 root 侧装配（与 `admin-wiring.ts` 同性质，从 `src/index.ts` 拆出）。
 *
 * 三件事：把探针、三个端点与页面渲染收拢成 deps；把「生成并保存访问令牌 / 建管理员」这两个
 * 需要宿主能力的动作落成实现；注册路由并在会话层就绪时清掉残留的 bootstrap 会话。
 * **访问令牌绝不写日志**：只出现在提交结果页的 HTML 里（一次性展示）。
 *
 * 未配置探针**不用** `makeTokenResolver`：那个解析器把「服务缺失 / 解析抛错」都吞成
 * `undefined`，会让「凭据服务尚未就绪」误判成「实例未配置」，于是在已配置实例上开引导窗口、
 * 甚至让向导覆盖掉已存在的 DSH_AUTH_TOKEN。这里用严格读取器，失败一律上抛成 `unknown`。
 */
export declare function makeBootstrapWiring(input: BootstrapWiringInput): BootstrapWiring;
//# sourceMappingURL=bootstrap-wiring.d.ts.map