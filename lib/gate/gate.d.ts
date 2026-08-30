import type { IncomingMessage } from "node:http";
/** Guard 判定时报告的被包装入口类别。 */
export type GuardKind = "exact" | "prefix" | "upgrade" | "fallback";
/** allow = 放行原 handler；deny = 由守卫执行 302/401/拒握手。 */
export type GateDecision = "allow" | "deny";
/** 门：对一次被守卫的请求给出放行/拒绝决策。 */
export interface Gate {
    decide(req: IncomingMessage, kind: GuardKind, pathname: string): GateDecision | Promise<GateDecision>;
}
/** M1 惰性门：恒放行。M2 用 token/密码门整体替换。 */
export declare const noopGate: Gate;
//# sourceMappingURL=gate.d.ts.map