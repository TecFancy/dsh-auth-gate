import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoginRateLimiter, UsersLoadResult, UsersSnapshot } from "../../shared/index.js";
import { type SessionStore } from "../../session/index.js";
export interface PasswordChangeDeps {
    sessions: () => SessionStore | undefined;
    cookieName: string;
    cookieSecure: boolean;
    /** 仅用于「users 文件缺失」warn 文案（P7 同款）。 */
    usersPath: string;
    /**
     * 写盘前的判定读（A7 §4.2）：只用于「用户存在 / 禁用 / 旧哈希」判定，**不是**锁内权威读；
     * mutator 收到的快照才来自 `mutateUsersFile` 的锁内新鲜读。
     */
    loadUsers: () => Promise<UsersLoadResult>;
    /** 锁内 read-modify-write（index.ts 注入 `(m) => mutateUsersFile(usersPath, m)`）。 */
    mutateUsers: (mutator: (snapshot: UsersSnapshot) => void | Promise<void>) => Promise<void>;
    /** 现口令验证（index.ts 注入 verifyPassword）；也用于锁内复核（A6 §10）。 */
    verify: (password: string, storedHash: string) => Promise<boolean>;
    /** 新口令哈希（index.ts 注入 hashPassword）。 */
    hash: (password: string) => Promise<string>;
    /** 改密独立限速桶（index.ts 新建，与登录 limiter 不同实例）。 */
    limiter: LoginRateLimiter;
    /** 客户端 IP（D19）；缺省回退 socket.remoteAddress。 */
    clientIp?: ((req: IncomingMessage) => string) | undefined;
    totpMode: "off" | "optional" | "required";
    verifyTotp: (secretB32: string, code: string, nowMs: number) => number | undefined;
    /** 防重放（index.ts 注入同一 replayGuard 单例）：同窗 counter 已用过 → false。 */
    replayCheck: (username: string, counter: number, code: string) => boolean;
    /** 写盘成功后撤销该 subject 的全部会话（含当前；index.ts 注入，内部 try/catch）。 */
    revoke: (subject: string) => Promise<void>;
    now: () => number;
    logger: {
        error(m: unknown): void;
        info(m: unknown): void;
        warn(m: unknown): void;
    };
}
/**
 * POST /auth/password（P1 §1）。处理顺序冻结，不得重排：
 * method 405 → parseFormBody(415/413) → 会话 cookie(401) → 限速桶(429) → 读 users(503)
 * → 恒时验证旧口令(401) → TOTP(401) → 策略(400) → hash → 锁内写盘(503)
 * → recordSuccess + 撤销全部会话 → 清 cookie + 200。
 * 顺序硬约束：写盘成功后才撤销会话；写盘失败绝不允许出现「全被踢但密码没改」。
 */
export declare function handlePasswordChange(deps: PasswordChangeDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=password-change.d.ts.map