import type { ServerResponse } from "node:http";
import {
  auditDenied,
  type AdminAuditContext,
  type AdminAuditLogger,
  type AdminDenyReason,
} from "./audit.js";

/**
 * 响应与拒绝出口。只依赖 logger + limiter 两样（AdminDeps 天然满足），
 * 避免 `respond` 反向依赖 `endpoints` 造成循环。
 */
export interface DenyDeps {
  logger: AdminAuditLogger;
  limiter: { recordFailure(ip: string, account: string | undefined): void };
}

/** JSON 写出（`no-store` + `pragma: no-cache` 冻结，§1）。 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function sendText(res: ServerResponse, status: number, body: string): void {
  res.setHeader("cache-control", "no-store");
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(body);
}

/** 拒绝：审计 + JSON 响应（不碰限速桶）。 */
export function deny(
  deps: DenyDeps,
  res: ServerResponse,
  ctx: AdminAuditContext,
  reason: AdminDenyReason,
  status: number,
  body: unknown,
): void {
  auditDenied(deps.logger, ctx, reason);
  sendJson(res, status, body);
}

/** 限流门**之后**的拒绝：额外计失败（§6「失败也计入本桶」，沿用 P1 口径）。 */
export function fail(
  deps: DenyDeps,
  res: ServerResponse,
  ctx: AdminAuditContext,
  reason: AdminDenyReason,
  status: number,
  body: unknown,
): void {
  deps.limiter.recordFailure(ctx.clientIp, ctx.actor);
  deny(deps, res, ctx, reason, status, body);
}

/** 415/413（复用既有 form-body 语义；413 先写 `connection: close`）；无 status 的异常向上抛。 */
export function respondFormError(res: ServerResponse, error: unknown): void {
  const failed = error as { status?: number; message?: string };
  if (typeof failed.status !== "number") throw error;
  res.setHeader("cache-control", "no-store");
  if (failed.status === 413) res.setHeader("connection", "close");
  res.writeHead(failed.status, { "content-type": "text/plain" });
  res.end(failed.message ?? "bad request");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 依赖抛出的 message 落盘前做**子串替换**（与 P1 `safeError` 同口径）：
 * 长度 ≥ 4 的请求明文逐段换成 `[redacted]`，其余运维上下文保留。
 * 日志铁律不依赖被注入依赖的自觉（hash/mutate/revoke 都可能把入参回显进 message）。
 */
export function safeMessage(error: unknown, secrets: readonly string[]): string {
  let message = errorMessage(error);
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.split(secret).join("[redacted]");
  }
  return message;
}
