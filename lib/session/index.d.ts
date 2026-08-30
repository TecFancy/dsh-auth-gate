/**
 * 会话层（核心机制层，与 gate/ 并列）：持久化 SessionStore + cookie 构建。
 * token / password 两个认证面共同消费；跨 slice import 只能走本 barrel。
 */
export * from "./session-store.js";
//# sourceMappingURL=index.d.ts.map