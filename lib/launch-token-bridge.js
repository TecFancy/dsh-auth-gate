/** 只从 authenticatedUrl 提取 token 的内部探针；三条失败原因分开，供桥选告警文案。 */
function probeLaunchToken(ctx) {
    try {
        const connection = ctx.get("connection");
        if (connection === undefined || typeof connection.authenticatedUrl !== "function") {
            return { kind: "inactive" };
        }
        // 固定 loopback base 仅用于触发 authenticatedUrl 的 URL 解析；返回值中的
        // host/scheme/其它 query 全部丢弃，只保留 launch token。
        const token = new URL(connection.authenticatedUrl("http://127.0.0.1")).searchParams.get("token");
        if (token === null || token === "") {
            return { kind: "failed", detail: "authenticatedUrl returned no token" };
        }
        return { kind: "ok", token };
    }
    catch (error) {
        return {
            kind: "failed",
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * 当前进程的 launch token（只从 `connection.authenticatedUrl` 取）。
 *
 * 服务缺失 / 旧版 dsh（无 `authenticatedUrl`）/ 返回里没有 token / 抛错 → `undefined`。
 * 首次引导通道拿它做常量时间比较，桥拿它拼登录后的 `/?token=`，两处读的是同一枚 token。
 */
export function readLaunchToken(ctx) {
    const probe = probeLaunchToken(ctx);
    return probe.kind === "ok" ? probe.token : undefined;
}
/**
 * dsh launch-token 桥（0.1.2-alpha 起 client-connection 的页面 token 门）：登录成功后
 * 302 到相对 `/?token=<launchToken>`，浏览器自动 mint dsh cookie，免去手动复制
 * `?token=`。只从 authenticatedUrl 取 token，host/scheme 一概丢弃 - 相对 Location
 * 由浏览器按当前 origin 补齐，规避 TLS 反代下的 http 降级与 Host 混淆（grok-4.6
 * review F1/F2）。connection 缺失 / 无 authenticatedUrl（旧版 dsh）/ 取不到 token →
 * undefined（保持原 302(next) 行为）。桥失败绝不影响登录成功。
 * 两把闩分开告警（F4）：服务缺失与调用异常互不毒化，各 warn 一次/进程。
 */
export function makeLaunchTokenBridge(ctx, log) {
    let warnedInactive = false;
    let warnedError = false;
    return () => {
        const probe = probeLaunchToken(ctx);
        if (probe.kind === "ok") {
            return Promise.resolve(`/?token=${encodeURIComponent(probe.token)}`);
        }
        if (probe.kind === "inactive") {
            if (!warnedInactive) {
                warnedInactive = true;
                log.warn("launch-token bridge inactive: no connection.authenticatedUrl (dsh < 0.1.2-alpha?)");
            }
            return Promise.resolve(undefined);
        }
        if (!warnedError) {
            warnedError = true;
            log.warn(`launch-token bridge unavailable: ${probe.detail}`);
        }
        return Promise.resolve(undefined);
    };
}
//# sourceMappingURL=launch-token-bridge.js.map