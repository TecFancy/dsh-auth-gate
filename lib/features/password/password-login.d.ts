import type { IncomingMessage, ServerResponse } from "node:http";
import { LoginRateLimiter, type UsersLoadResult } from "../../shared/index.js";
import { type SessionStore } from "../../session/index.js";
export { buildChallengeValue, CHALLENGE_COOKIE, CHALLENGE_TTL_SECONDS, parseChallengeValue, } from "./challenge-cookie.js";
export interface PasswordLoginDeps {
    sessions: () => SessionStore | undefined;
    cookieName: string;
    cookieSecure: boolean;
    sessionTtl: number;
    /** 仅用于"文件缺失"warn 消息（P23）。 */
    usersPath: string;
    loadUsers: () => Promise<UsersLoadResult>;
    /** 与 verifyPassword 同形 `(password, storedHash)`：index.ts 直接注入 verifyPassword。 */
    verify: (password: string, storedHash: string) => Promise<boolean>;
    limiter: LoginRateLimiter;
    /** TOTP 模式（M4 T4）：off 忽略 secret；optional 有 secret 才两段式；required 全员两段式。 */
    totpMode: "off" | "optional" | "required";
    /** 注入的 TOTP 校验（index.ts 从 features/totp 装配；命中返回匹配 counter）。 */
    verifyTotp: (secretB32: string, code: string, nowMs: number) => number | undefined;
    /** 注入的防重放守卫（index.ts 装配单例）。 */
    replayCheck: (username: string, counter: number, code: string) => boolean;
    /** 注入的当前时间（ms epoch；测试注入固定时钟）。 */
    now: () => number;
    /** 挑战 cookie HMAC 密钥（进程级，apply() 生成；D10）。 */
    challengeMacKey: Uint8Array;
    logger: {
        error(message: unknown): void;
        info(message: unknown): void;
        warn(message: unknown): void;
    };
}
/**
 * POST /auth/login（password 模式，P14 + M4 T6）。完成全部响应写出（415/413/401/429/503/302）。
 * 流程顺序冻结：body → 挑战 cookie 分流 → 限速 → 用户文件 → 恒时验证 → 会话/挑战。
 * 挑战提交路径（有合法挑战 cookie + body 含 code）：验证 TOTP → 发会话；
 * 否则走密码路径：验证通过后按 totpMode 决定直接发会话或发挑战 cookie。
 * 不吞不带 `status` 的流异常。
 */
export declare function handlePasswordLogin(deps: PasswordLoginDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=password-login.d.ts.map