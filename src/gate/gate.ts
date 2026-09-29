import type { IncomingMessage } from "node:http";

/** Guard 判定时报告的被包装入口类别。 */
export type GuardKind = "exact" | "prefix" | "upgrade" | "fallback";

/** 302 拒绝：`location` 必须是站内相对路径（守卫渲染前还会再消毒一次）。 */
export interface GateRedirectDeny {
  deny: { redirect: string };
}

/** 状态码拒绝（API/JSON 面）：直接回 401/403，不做重定向。 */
export interface GateStatusDeny {
  deny: { status: 401 | 403 };
}

/** WS 升级拒绝：守卫在 ws 协商前拒握手，不进入原 handler，也不给 socket 挂监听器。 */
export interface GateUpgradeDeny {
  deny: { upgrade: true };
}

/**
 * 拒绝决策（P2 扩展；字符串分支向后兼容既有夹具）：
 * - `"deny"`：守卫默认语义 = 浏览器导航 302 登录页（带 `next`），其余 401；
 * - `{ deny: { redirect } }`：302 到 gate 给出的站内相对路径（受限会话 → `/auth/password`）；
 * - `{ deny: { status } }`：直接 401/403；
 * - `{ deny: { upgrade: true } }`：拒 WS 握手（误落到 HTTP 面时按 401 兜底）。
 */
export type GateDeny = "deny" | GateRedirectDeny | GateStatusDeny | GateUpgradeDeny;

/** allow = 放行原 handler；拒绝分支由守卫执行 302/401/403/拒握手。 */
export type GateDecision = "allow" | GateDeny;

/** 门：对一次被守卫的请求给出放行/拒绝决策。 */
export interface Gate {
  decide(
    req: IncomingMessage,
    kind: GuardKind,
    pathname: string,
  ): GateDecision | Promise<GateDecision>;
}

/** M1 惰性门：恒放行。M2 用 token/密码门整体替换。 */
export const noopGate: Gate = { decide: () => "allow" };
