import { Context, type Fiber } from "@deepseek-ai/cordis";
import type { WrappableServer } from "./gate/index.js";
/**
 * `integration.auth.test.ts` 的共享装配夹具：真实 cordis + webserver + storage 栈，
 * 外加探针路由（`/__probe`、`/`）与一条 WS 升级路由。`connection` 选项再提供一个假
 * connection（模拟 dsh client-connection 的 `authenticatedUrl`），用于 launch-token 桥。
 */
export type RealServer = WrappableServer & {
    readonly port: number;
};
export declare function upgradeRequest(port: number, headers: Record<string, string>): Promise<number | "upgrade">;
export declare function waitFor(condition: () => boolean, timeoutMs?: number): Promise<void>;
export declare function mountStack(options: {
    withCredentials: boolean;
    /**
     * 假 dsh connection 的形状：`authenticatedUrl` = dsh ≥ 0.1.2-alpha；`bare` = 服务在但没有
     * 这个函数（旧版 dsh），桥应回落到 `next`。刻意在插件 apply **之后**才 provide，
     * 用来锁住桥「登录时才 `ctx.get("connection")`」的惰性查找（晚注册的 connection 同样有效）。
     */
    connection?: "authenticatedUrl" | "bare";
}): Promise<{
    ctx: Context;
    port: number;
    fibers: Fiber[];
    root: string;
    token: string | undefined;
}>;
export declare function unmountStack(fibers: Fiber[], root: string): Promise<void>;
//# sourceMappingURL=integration-auth-helpers.d.ts.map