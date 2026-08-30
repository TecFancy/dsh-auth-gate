import type { IncomingMessage } from "node:http";
import type { Gate, GuardKind } from "../../gate/index.js";
import type { SessionStore } from "../../session/index.js";
export interface PasswordGateOptions {
    /** 会话访问器（M16 同形）：每次 decide 现取；undefined = 会话通道不可用。 */
    sessions: () => SessionStore | undefined;
    cookieName: string;
}
/**
 * password 模式门（P12）：白名单 → 会话 cookie → Bearer 会话 token → deny。
 * 门内零 KDF、零文件 IO、同步返回；Bearer 通道按会话查表（可吊销可过期）。
 */
export declare class PasswordGate implements Gate {
    private readonly sessions;
    private readonly cookieName;
    constructor(options: PasswordGateOptions);
    decide(req: IncomingMessage, _kind: GuardKind, pathname: string): "allow" | "deny";
}
//# sourceMappingURL=password-gate.d.ts.map