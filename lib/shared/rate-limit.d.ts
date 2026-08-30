export interface RateLimitOptions {
    /** 连续失败多少次后进入锁定。默认 5。 */
    maxFailures?: number;
    /** 首次锁定的基础时长（秒），此后按 2 的幂增长。默认 30。 */
    baseDelaySeconds?: number;
    /** 锁定上限（秒）。默认 900。 */
    maxDelaySeconds?: number;
    /** 失败计数衰减窗口（秒）：窗口内无新失败即清零。默认 600。 */
    windowSeconds?: number;
    /** 时钟（毫秒 epoch）。默认 Date.now；测试注入。 */
    now?: () => number;
}
export type RateLimitCheck = {
    allowed: true;
} | {
    allowed: false;
    retryAfterSeconds: number;
};
/**
 * 登录限速器（P10）：IP + 账号双桶、失败指数退避、窗口衰减、条目上限。
 * 内存态：重启清零；端点锁定期不调 recordFailure（429 短路，锁不被延长）。
 */
export declare class LoginRateLimiter {
    private readonly maxFailures;
    private readonly baseDelayMs;
    private readonly maxDelayMs;
    private readonly windowMs;
    private readonly now;
    private readonly byIp;
    private readonly byAccount;
    constructor(options?: RateLimitOptions);
    check(ip: string, account: string | undefined): RateLimitCheck;
    recordFailure(ip: string, account: string | undefined): void;
    recordSuccess(ip: string, account: string | undefined): void;
    /** 返回该桶当前剩余锁定毫秒数（>0 = 锁定中）；同时做锁到期/窗口衰减清零。 */
    private checkBucket;
    private recordBucket;
    /** 删除清零条目；条目超 10000 时删除最早插入的（Map 迭代序）。 */
    private prune;
    private cap;
}
//# sourceMappingURL=rate-limit.d.ts.map