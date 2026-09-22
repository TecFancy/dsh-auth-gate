/**
 * 会话层（核心机制层，与 gate/ 并列）：持久化 SessionStore + cookie 构建。
 * token / password 两个认证面共同消费；跨 slice import 只能走本 barrel。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记。
 */
export { buildSetCookie, COOKIE_FLAGS, digestToken, sessionDomainSpec, SessionStore, } from "./session-store.js";
export type { IssuedSession, Session } from "./session-store.js";
//# sourceMappingURL=index.d.ts.map