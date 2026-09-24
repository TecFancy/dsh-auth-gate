/**
 * 管理面审计（P2 §5）：只走结构化日志，事件对象**固定 10 个键**（测试按键集断言）。
 *
 * 事件名：成功 `audit.user.password_reset`；拒绝/失败 `audit.user.password_reset.denied`。
 * 绝不携带口令 / `code` / 哈希；`GET /auth/users` 不产生审计（噪声）。
 * `revoke_failed` **不是** denied reason：写盘已成功 ⇒ 走成功事件 + `sessionsRevoked:false`，
 * 否则 SIEM 会把 200 当失败拒绝（§5）。
 */
/** 拒绝原因枚举（§5，语义不合并）。 */
export type AdminDenyReason = "self" | "forbidden" | "bad_origin" | "bad_target" | "not_found" | "bad_reauth" | "policy" | "rate_limited" | "io" | "unauthenticated";
export declare const RESET_EVENT = "audit.user.password_reset";
export declare const RESET_DENIED_EVENT = "audit.user.password_reset.denied";
/** 一次管理重置的审计上下文（随处理推进补全：actor/target/reauth/targetDisabled）。 */
export interface AdminAuditContext {
    ts: number;
    actor: string;
    target: string;
    clientIp: string;
    reauth: "totp" | "none";
    targetDisabled: boolean;
}
/** 只依赖 info/error 两档（AdminDeps 冻结面）。 */
export interface AdminAuditLogger {
    info(message: unknown): void;
    error(message: unknown): void;
}
/** 审计事件对象（10 键恒定，成功事件 `reason` 为 undefined 但键仍在）。 */
export interface AdminAuditEvent {
    event: typeof RESET_EVENT | typeof RESET_DENIED_EVENT;
    ts: number;
    actor: string;
    target: string;
    clientIp: string;
    ok: boolean;
    reason: AdminDenyReason | undefined;
    reauth: "totp" | "none";
    sessionsRevoked: boolean;
    targetDisabled: boolean;
}
/**
 * 拒绝事件。**未认证（`actor === ""`）一律 info**：Origin 门在会话门之前，扫描器
 * 不带 cookie 的畸形 POST 会先撞 bad_origin，若按 error 记就能被无认证无限灌爆告警桶
 * （§5 降噪意图，评审 F2）。已认证拒绝走 error（进告警视野）。
 */
export declare function auditDenied(logger: AdminAuditLogger, ctx: AdminAuditContext, reason: AdminDenyReason): void;
/**
 * 成功事件（写盘已成功）。`sessionsRevoked === false` 时提级到 **error**（200 但运维必须看见），
 * 仍只发一条事件：事件名保持成功，字段 `sessionsRevoked:false`（§5 / 验收 14）。
 */
export declare function auditSuccess(logger: AdminAuditLogger, ctx: AdminAuditContext, sessionsRevoked: boolean): void;
//# sourceMappingURL=audit.d.ts.map