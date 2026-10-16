/**
 * session 实体公共面：持久化 SessionStore + cookie 构建 + 会话端点（logout / status）。
 * token / password 两个认证面共同消费；跨 slice import 只能走本 barrel。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记。
 */
export { buildSetCookie, COOKIE_FLAGS, digestToken, sessionDomainSpec, SessionStore, } from "./model/session-store.js";
export type { IssuedSession, Session } from "./model/session-store.js";
export { handleLogout, handleStatus } from "./api/session-endpoints.js";
export type { AuthHttpDeps } from "./api/session-endpoints.js";
//# sourceMappingURL=index.d.ts.map