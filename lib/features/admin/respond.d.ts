import type { ServerResponse } from "node:http";
import { type AdminAuditContext, type AdminAuditLogger, type AdminDenyReason } from "./audit.js";
/**
 * 响应与拒绝出口。只依赖 logger + limiter 两样（AdminDeps 天然满足），
 * 避免 `respond` 反向依赖 `endpoints` 造成循环。
 */
export interface DenyDeps {
    logger: AdminAuditLogger;
    limiter: {
        recordFailure(ip: string, account: string | undefined): void;
    };
}
/** JSON 写出（`no-store` + `pragma: no-cache` 冻结，§1）。 */
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
export declare function sendText(res: ServerResponse, status: number, body: string): void;
/** 拒绝：审计 + JSON 响应（不碰限速桶）。 */
export declare function deny(deps: DenyDeps, res: ServerResponse, ctx: AdminAuditContext, reason: AdminDenyReason, status: number, body: unknown): void;
/** 限流门**之后**的拒绝：额外计失败（§6「失败也计入本桶」，沿用 P1 口径）。 */
export declare function fail(deps: DenyDeps, res: ServerResponse, ctx: AdminAuditContext, reason: AdminDenyReason, status: number, body: unknown): void;
/** 415/413（复用既有 form-body 语义；413 先写 `connection: close`）；无 status 的异常向上抛。 */
export declare function respondFormError(res: ServerResponse, error: unknown): void;
export declare function errorMessage(error: unknown): string;
/**
 * 依赖抛出的 message 落盘前做**子串替换**（与 P1 `safeError` 同口径）：
 * 长度 ≥ 4 的请求明文逐段换成 `[redacted]`，其余运维上下文保留。
 * 日志铁律不依赖被注入依赖的自觉（hash/mutate/revoke 都可能把入参回显进 message）。
 */
export declare function safeMessage(error: unknown, secrets: readonly string[]): string;
//# sourceMappingURL=respond.d.ts.map