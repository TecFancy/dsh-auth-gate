/**
 * 本地反向代理（dsh-auth-proxy）。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记。
 */
export { assertLoopbackListen, bearerOf, filterRequestHeaders, filterResponseHeaders, filterUpgradeResponseHeaders, HOP_BY_HOP_HEADERS, isLoopbackHostname, parseListen, rewriteSetCookie, } from "./proxy-headers.js";
export { createProxyServer, validateProxyOptions } from "./proxy.js";
export type { ProxyListen, ProxyOptions } from "./proxy.js";
//# sourceMappingURL=index.d.ts.map