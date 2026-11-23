import { readFileSync } from "node:fs";
/**
 * 本包版本号：加载时读一次 `package.json` 的 `version`。
 *
 * **为什么由 host 读、而不是让它成为前端构建时常量**：设置页是浏览器里跑的 bundle，
 * 插件升级后页面可能还在用缓存的旧 bundle；那时前端常量会报出一个已经不在机器上的版本。
 * host 是真正在跑这份代码的进程，它说 0.24.0 才是 0.24.0。
 *
 * 源码与编译后的 `lib/` 距包根同样四级（与 telemetry 读 manifest 的深度一致）。
 * 读不到、或 `version` 不是非空字符串时返回空串：调用方据此**不渲染**版本行，
 * 绝不回落到写死的版本常量（写死的版本迟早与包不符，那正是这个字段要避免的谎）。
 */
function readVersion() {
    try {
        const raw = readFileSync(new URL("../../../../package.json", import.meta.url), "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null)
            return "";
        const version = parsed.version;
        return typeof version === "string" ? version : "";
    }
    catch {
        return "";
    }
}
/** 运行中进程的版本号；`""` 表示读不到（`/auth/status` 因此不写 `version` 键）。 */
export const SELF_VERSION = readVersion();
