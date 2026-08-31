import type { Context } from "@deepseek-ai/cordis";
/**
 * dsh launch-token 桥（0.1.2-alpha 起 client-connection 的页面 token 门）：登录成功后
 * 302 到相对 `/?token=<launchToken>`，浏览器自动 mint dsh cookie，免去手动复制
 * `?token=`。只从 authenticatedUrl 取 token，host/scheme 一概丢弃 - 相对 Location
 * 由浏览器按当前 origin 补齐，规避 TLS 反代下的 http 降级与 Host 混淆（grok-4.6
 * review F1/F2）。connection 缺失 / 无 authenticatedUrl（旧版 dsh）/ 取不到 token →
 * undefined（保持原 302(next) 行为）。桥失败绝不影响登录成功。
 * 两把闩分开告警（F4）：服务缺失与调用异常互不毒化，各 warn 一次/进程。
 */
export declare function makeLaunchTokenBridge(ctx: Context, log: {
    warn(message: unknown): void;
}): () => Promise<string | undefined>;
//# sourceMappingURL=launch-token-bridge.d.ts.map