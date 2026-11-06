/**
 * shared/guard 段公共面：跨段 import 的唯一入口。
 * 守卫核心机制：Gate 决策词汇 + webServer 包装（handler 与 0.2.2 resource 两种
 * 路由形态）+ 启动自检。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记。
 */
export { crossSiteBounceResponse, isCrossSiteDocumentNavigation, serveCrossSiteBounce, } from "./cross-site-bounce.js";
export { noopGate } from "./gate.js";
export { denyForbidden, denyHttp, denyUpgrade, GUARDED, guardHttp, guardUpgrade, isGuarded, isNavigationRequest, isProxyDeniedRequest, isPublicStaticPath, isSafeLocation, PROXY_MARKER_HEADER, PUBLIC_STATIC_PATHS, wrapServer, } from "./guard.js";
export { denyReply, guardReplyToResponse, writeGuardReply } from "./http.js";
export { guardResource, toGuardRequest } from "./resource.js";
export { assertGuarded } from "./self-check.js";
//# sourceMappingURL=index.js.map