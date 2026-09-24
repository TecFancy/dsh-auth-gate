import type { IncomingMessage, ServerResponse } from "node:http";
import type { UserRecord, UsersSnapshot } from "../../shared/index.js";
import type { Session } from "../../session/index.js";
import { type AdminAuditContext } from "./audit.js";
import type { AdminDeps, ResetInput } from "./deps.js";
/** P2 §6：Origin / Sec-Fetch-Site 同源校验（fail-closed，publicHost 缺省只信 Sec-Fetch-Site）。 */
export declare function originAccepted(deps: AdminDeps, req: IncomingMessage): boolean;
/** 会话定位：只认 cookie（M5 同口径），Bearer 不参与；store/token 无效一律 undefined。 */
export declare function locateSession(deps: AdminDeps, req: IncomingMessage): Session | undefined;
/** 管理桶门（key = actor subject + clientIp）：锁定 → retry-after 秒数；放行 → undefined。 */
export declare function lockoutSeconds(deps: AdminDeps, ctx: AdminAuditContext): number | undefined;
/**
 * 现读 users.yaml。失败 → 503（读失败**不计失败**，与 P1 端点同口径）；
 * 带 `ctx` 时记审计 `io`（已认证拒绝必须留痕，§5）。
 */
export declare function loadUsersOr503(deps: AdminDeps, res: ServerResponse, ctx?: AdminAuditContext, secrets?: readonly string[]): Promise<UsersSnapshot | undefined>;
/**
 * admin 校验（§2）：**每请求现读 users.yaml** 的 `role === "admin" && !disabled`，
 * 绝不信会话内缓存（会话对象本就没有 role）。非 admin / 不存在 / 禁用 → 403。
 */
export declare function adminActor(deps: AdminDeps, res: ServerResponse, ctx: AdminAuditContext, secrets?: readonly string[]): Promise<UserRecord | undefined>;
/**
 * 限流之后的校验链（§2）：现读 users → 目标名（`USERNAME_RE`）→ 404 → `self` 403 →
 * 策略（含 `≠旧`：用目标现哈希验一次）→ 条件式 TOTP。
 * **策略在 TOTP 之前**：口令不合规不该消费一枚验证码（§2 次序理由）。
 */
export declare function resetTarget(deps: AdminDeps, res: ServerResponse, ctx: AdminAuditContext, input: ResetInput): Promise<UserRecord | undefined>;
/** 新口令哈希；失败 → `ioFailure`（503 + 审计 `io` + 计失败）。 */
export declare function hashOr503(deps: AdminDeps, res: ServerResponse, ctx: AdminAuditContext, input: ResetInput): Promise<string | undefined>;
/**
 * 锁内复核失败（TOCTOU，grok #5）：actor 在**锁外授权读之后**被降权/禁用。
 * 与 IO 失败严格区分：映射为 403 `forbidden`，不写盘、不吊销、不计失败。
 */
export declare class ActorNotAdminError extends Error {
    constructor(actor: string);
}
/**
 * 锁内 RMW（唯一变更入口）：**先复核 actor 仍是 admin 且未禁用**（TOCTOU，grok #5），
 * 再设 `must_change_password: true` + 新哈希。`totpSecret` / `role` / `disabled` 一律不动（验收 8）；
 * 只改这两个字段，last-admin 判定不会误触发。目标在锁内消失 → 抛错 → 503（不静默写幽灵用户）。
 */
export declare function writeReset(deps: AdminDeps, res: ServerResponse, ctx: AdminAuditContext, hashed: string, secrets?: readonly string[]): Promise<boolean>;
/** 撤销目标全部会话（`self` 已挡掉 ⇒ 天然不含 actor）；注入方保证不抛，这里仍兜底。 */
export declare function revokeTarget(deps: AdminDeps, ctx: AdminAuditContext, secrets?: readonly string[]): Promise<boolean>;
//# sourceMappingURL=reset-steps.d.ts.map