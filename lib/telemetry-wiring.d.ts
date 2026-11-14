import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { AdmitHook } from "./host/shared/guard/index.js";
import { type VolatileField } from "./host/shared/telemetry/index.js";
/**
 * 匿名使用统计的 root 侧装配（与 `admin-wiring.ts` / `bootstrap-wiring.ts` 同性质）。
 *
 * 本文件是这条功能的自包含边界：它自己的配置片段（`TelemetryFields` +
 * `telemetryConfigFields`）、上报器装配、settings 写回通道与 users.yaml 的惰性读取都在这里，
 * `src/index.ts` 只留下 `extends`、一行 schema 展开和一次 `wireTelemetry` 调用。
 */
/** 两个配置项的类型（`AuthConfig` 直接 extends 本接口）。 */
export interface TelemetryFields {
    /**
     * 匿名使用统计开关（默认 `true`，**可见可关**）：一次请求被门放行之后，最多每 24 小时发一次
     * 匿名报文（包版本、Node 主版本、平台、架构、门模式 / TOTP 模式 / 用户数分桶）。不发用户名、
     * 口令哈希、TOTP 密钥、会话 id、token、客户端 IP、请求路径或主机名；设为 `false` 后一次请求
     * 都不发。见 README「匿名使用统计」。
     */
    telemetry: boolean;
    /**
     * 匿名安装 id（UUID v4，`.volatile().hidden(true)`）：首次需要上报时生成，经宿主 settings
     * 服务写回这个 volatile 字段，此后每次读到同一个值。隐藏、不参与界面；宿主没有 settings
     * 服务时它只留在内存里（每次重启换一个），绝**不**退化到写一个私有文件。
     */
    installId: VolatileField<string>;
}
/** 两个配置项对应的 schema 节点（展开进 `src/index.ts` 的 `Config`，顺序即绑定顺序）。 */
export declare const telemetryConfigFields: {
    installId: z<string, string, "volatile-defined">;
    telemetry: z<boolean, boolean, "defined">;
};
/** 只看上报需要的配置子集（结构兼容 `AuthConfig`；根文件传整个 config 即可）。 */
export interface TelemetryWiringConfig extends TelemetryFields {
    mode: "token" | "password";
    totp: "off" | "optional" | "required";
    usersFile: string;
}
/**
 * 装好匿名上报，返回守卫的放行钩子。
 *
 * 用户数**不在请求路径上读**：只有上报真正到期（至多每 24 小时一次）时，才用现有的
 * `loadUsersFile` 解析一遍 users.yaml 取用户数；token 模式不读盘，恒报 `"1"`。
 *
 * @param ctx - 宿主上下文（`settings` 惰性现取，与 `credentials` 同一套软接方式）。
 * @param config - 上报需要的配置子集（users.yaml 路径也在这里解析，与登录路径同一个文件）。
 * @returns 交给 `wrapServer` 的放行钩子；`telemetry: false` 时为 undefined（不挂钩子）。
 */
export declare function wireTelemetry(ctx: Context, config: TelemetryWiringConfig): AdmitHook | undefined;
//# sourceMappingURL=telemetry-wiring.d.ts.map