/**
 * shared/telemetry 段公共面：匿名使用统计的上报器、v1 报文与它需要的宿主 seam。
 *
 * 只有 host 半边引用它：这是本插件唯一的出站请求，client 半边不碰网络。
 * 显式清单（与 guard 段同规）：新增导出必须在此登记。
 */
export { buildPayload, makeTelemetry, PING_INTERVAL_MS, PING_TIMEOUT_MS, TELEMETRY_ENDPOINT, TELEMETRY_VERSION, usersBucket, } from "./telemetry.js";
//# sourceMappingURL=index.js.map