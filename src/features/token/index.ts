/**
 * token 认证面（M2 共享口令门）。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记。
 */
export { registerAuthEndpoints } from "./auth-endpoints.js";
export type { AuthEndpointsDeps } from "./auth-endpoints.js";
export { safeEqual, TokenGate } from "./token-gate.js";
export type { TokenGateOptions } from "./token-gate.js";
