import { Context, type Fiber } from "@deepseek-ai/cordis";
import type { WrappableServer } from "./gate/index.js";
/**
 * `integration.auth.test.ts` 的共享装配夹具：真实 cordis + webserver + storage 栈，
 * 外加一个探针路由与一条 WS 升级路由。`withConnection` 再提供一个假 connection
 * （模拟 dsh client-connection 的 `authenticatedUrl`），用于 launch-token 桥。
 */
export type RealServer = WrappableServer & {
    readonly port: number;
};
export declare function upgradeRequest(port: number, headers: Record<string, string>): Promise<number | "upgrade">;
export declare function waitFor(condition: () => boolean, timeoutMs?: number): Promise<void>;
export declare function mountStack(options: {
    withCredentials: boolean;
    withConnection?: boolean;
}): Promise<{
    ctx: Context;
    port: number;
    fibers: Fiber[];
    root: string;
    token: string | undefined;
}>;
export declare function unmountStack(fibers: Fiber[], root: string): Promise<void>;
//# sourceMappingURL=integration-auth-helpers.d.ts.map