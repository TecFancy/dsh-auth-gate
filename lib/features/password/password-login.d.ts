import type { IncomingMessage, ServerResponse } from "node:http";
import { LoginRateLimiter, type UsersLoadResult } from "../../shared/index.js";
import { type SessionStore } from "../../session/index.js";
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
    logger: {
        error(message: unknown): void;
        info(message: unknown): void;
        warn(message: unknown): void;
    };
}
/**
 * POST /auth/login（password 模式，P14）。完成全部响应写出（415/413/401/429/503/302）。
 * 流程顺序冻结：body → 限速 → 用户文件 → 恒时验证 → 会话。不吞不带 `status` 的流异常。
 */
export declare function handlePasswordLogin(deps: PasswordLoginDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=password-login.d.ts.map