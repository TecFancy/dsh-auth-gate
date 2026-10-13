/**
 * 管理面审计（P2 §5）：只走结构化日志，事件对象**固定 10 个键**（测试按键集断言）。
 *
 * 事件名：成功 `audit.user.password_reset`；拒绝/失败 `audit.user.password_reset.denied`。
 * 绝不携带口令 / `code` / 哈希；`GET /auth/users` 不产生审计（噪声）。
 * `revoke_failed` **不是** denied reason：写盘已成功 ⇒ 走成功事件 + `sessionsRevoked:false`，
 * 否则 SIEM 会把 200 当失败拒绝（§5）。
 */

/** 拒绝原因枚举（§5，语义不合并）。 */
export type AdminDenyReason =
  | "self"
  | "forbidden"
  | "bad_origin"
  | "bad_target"
  | "not_found"
  | "bad_reauth"
  | "policy"
  | "rate_limited"
  | "io"
  | "unauthenticated";

export const RESET_EVENT = "audit.user.password_reset";
export const RESET_DENIED_EVENT = "audit.user.password_reset.denied";

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

/** `USERNAME_RE` 上限（64）：审计里的 target 是诊断线索，不是请求回显，超长一律截断。 */
const TARGET_LIMIT = 64;

/** 省略标记 3 字符，截断结果**含标记**仍 ≤ 64。 */
const ELLIPSIS = "...";

/**
 * 日志里不该出现的不可见字符（grok #4 + 复审 G3 补强）：C0、DEL/C1（含 U+0085）、
 * 行/段分隔符、双向控制符与零宽字符。它们不改语义，但能把审计行伪装成别的记录、
 * 或让 64 字符的窗口里藏东西，故入审计前一律剥掉（业务字段 `ctx.target` 保持原值）。
 */
function isInvisible(code: number): boolean {
  return (
    code <= 0x1f || // C0
    (code >= 0x7f && code <= 0x9f) || // DEL + C1（含 NEL）
    code === 0x2028 ||
    code === 0x2029 || // line / paragraph separator
    (code >= 0x202a && code <= 0x202e) || // bidi embedding / override
    (code >= 0x2066 && code <= 0x2069) || // bidi isolates
    (code >= 0x200b && code <= 0x200f) || // zero-width + LRM / RLM
    code === 0xfeff // BOM / zero-width no-break space
  );
}

function stripControlChars(value: string): string {
  let out = "";
  for (const char of value) {
    if (isInvisible(char.codePointAt(0) ?? 0)) continue;
    out += char;
  }
  return out;
}

/**
 * 审计用 target：**先剥不可见字符，再**超长截断加省略标记
 * （8 KB 扫描器 payload 与 `\r\n` 注入都不得进日志；业务字段 `ctx.target` 保持原值）。
 */
function clipTarget(target: string): string {
  const stripped = stripControlChars(target);
  if (stripped.length <= TARGET_LIMIT) return stripped;
  return `${stripped.slice(0, TARGET_LIMIT - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * 拒绝事件。**未认证（`actor === ""`）一律 info**：Origin 门在会话门之前，扫描器
 * 不带 cookie 的畸形 POST 会先撞 bad_origin，若按 error 记就能被无认证无限灌爆告警桶
 * （§5 降噪意图，评审 F2）。已认证拒绝走 error（进告警视野）。
 */
export function auditDenied(
  logger: AdminAuditLogger,
  ctx: AdminAuditContext,
  reason: AdminDenyReason,
): void {
  const event: AdminAuditEvent = {
    event: RESET_DENIED_EVENT,
    ...ctx,
    target: clipTarget(ctx.target),
    ok: false,
    reason,
    sessionsRevoked: false,
  };
  if (ctx.actor === "" || reason === "unauthenticated") logger.info(event);
  else logger.error(event);
}

/**
 * 成功事件（写盘已成功）。`sessionsRevoked === false` 时提级到 **error**（200 但运维必须看见），
 * 仍只发一条事件：事件名保持成功，字段 `sessionsRevoked:false`（§5 / 验收 14）。
 */
export function auditSuccess(
  logger: AdminAuditLogger,
  ctx: AdminAuditContext,
  sessionsRevoked: boolean,
): void {
  const event: AdminAuditEvent = {
    event: RESET_EVENT,
    ...ctx,
    target: clipTarget(ctx.target),
    ok: true,
    reason: undefined,
    sessionsRevoked,
  };
  if (sessionsRevoked) logger.info(event);
  else logger.error(event);
}
