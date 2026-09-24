import type { IncomingMessage } from "node:http";
import type { Gate, GateDecision, GuardKind } from "../../gate/index.js";
import type { SessionStore } from "../../session/index.js";
export interface PasswordGateOptions {
    /** 会话访问器（M16 同形）：每次 decide 现取；undefined = 会话通道不可用。 */
    sessions: () => SessionStore | undefined;
    cookieName: string;
}
/**
 * password 模式门（P12 + P2 ④ kind 感知）：白名单（`/auth` 前缀 + 公开只读静态路径）
 * → 会话 cookie → Bearer 会话 token → deny。门内零 KDF、零文件 IO（**绝不读 users.yaml**）、
 * 同步返回；Bearer 通道按会话查表（可吊销可过期）。
 *
 * `session.kind === "password-change-only"` 的受限会话只放行 `/auth` 前缀，且：
 * `GET /auth/login` → 302 改密页、`POST /auth/login` → 403；其余（含 `/auth/users*`）
 * 放行进 handler，由 handler 按 kind 细分（管理面回 403）。宿主 `/api`、静态、`/plugins`
 * 与 WS 一律 deny（导航 302 `/auth/password`，API 401，WS 拒握手）。
 */
export declare class PasswordGate implements Gate {
    private readonly sessions;
    private readonly cookieName;
    constructor(options: PasswordGateOptions);
    decide(req: IncomingMessage, kind: GuardKind, pathname: string): GateDecision;
    /** `/auth` 前缀内：只有受限会话需要细分；其余一律交 handler（method 矩阵在 handler）。 */
    private decideAuthPath;
    /** 会话解析：cookie → Bearer；store 不可用 / 无凭证 / 已吊销 / 已过期 → undefined。 */
    private sessionOf;
}
//# sourceMappingURL=password-gate.d.ts.map