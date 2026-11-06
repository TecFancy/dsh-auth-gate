import type { IncomingMessage } from "node:http";
/** Guard 判定时报告的被包装入口类别。 */
export type GuardKind = "exact" | "prefix" | "upgrade" | "fallback";
/**
 * 门实际读取的请求契约：只要 `url`、`method` 和请求头。
 *
 * `IncomingMessage` 天然满足它（node:http 的 handler 入口原样传进来即可）；Fetch
 * `Request` 形态的 resource 入口由守卫复制这三项后传进来，不需要伪造完整
 * `IncomingMessage`，也不把 socket 这类 node 专属字段带进门的语义。
 */
export type GuardRequest = Pick<IncomingMessage, "url" | "method" | "headers">;
/** 302 拒绝：`location` 必须是站内相对路径（守卫渲染前还会再消毒一次）。 */
export interface GateRedirectDeny {
    deny: {
        redirect: string;
    };
}
/** 状态码拒绝（API/JSON 面）：直接回 401/403，不做重定向。 */
export interface GateStatusDeny {
    deny: {
        status: 401 | 403;
    };
}
/** WS 升级拒绝：守卫在 ws 协商前拒握手，不进入原 handler，也不给 socket 挂监听器。 */
export interface GateUpgradeDeny {
    deny: {
        upgrade: true;
    };
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
    decide(req: GuardRequest, kind: GuardKind, pathname: string): GateDecision | Promise<GateDecision>;
}
/**
 * 放行钩子：门返回 `allow` 之后、守卫执行原入口之前调用一次，回答的是「门放行了这次请求」。
 *
 * 它**不在门的判定路径上**：`decide()` 已经给出结论，钩子既不参与结论，也不在拒绝分支上出现。
 * 四类入口（exact / prefix / fallback / upgrade、handler 与 resource 两种形态）走同一条钩子。
 * 实现必须自己吞掉所有异常：守卫不 try/catch，钩子抛错会变成一次放行请求的失败；钩子也不得
 * 阻塞，异步工作交给它自己在后台完成。
 */
export type AdmitHook = () => void;
/** M1 惰性门：恒放行。M2 用 token/密码门整体替换。 */
export declare const noopGate: Gate;
//# sourceMappingURL=gate.d.ts.map