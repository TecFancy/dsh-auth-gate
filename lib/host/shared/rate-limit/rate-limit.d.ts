import { type AdmissionResult, type RateLimitCheck, type RateLimitOptions, type RateLimitScope } from "./types.js";
/**
 * 登录限速器（P10）：IP + 账号双桶、分域计数、失败指数退避、窗口衰减、条目上限。
 *
 * 内存态：重启清零。三种使用方式：
 * - `admit()` 受理一次尝试并返回结算句柄：检查、占位、记账在同一同步段完成，
 *   并发请求不能全部看到“未锁定”；这是登录路径（口令 / TOTP / passkey / token）的入口。
 * - `check()` / `recordFailure()` / `recordSuccess()` 保留给已认证的管理面与改密面
 *   （它们不是暴力破解入口，且流程中间还有别的锁）。
 * - `clearAccount()` 供管理员重置后解锁（清该账号所有域）。
 */
export declare class LoginRateLimiter {
    private readonly maxFailures;
    private readonly baseDelayMs;
    private readonly maxDelayMs;
    private readonly windowMs;
    private readonly maxConcurrentPerIp;
    private readonly now;
    private readonly byIp;
    private readonly byAccount;
    /** admit 计数：prune 是 O(n)，分摊到每 64 次受理一次，避免每个请求全表扫描。 */
    private admitsSincePrune;
    constructor(options?: RateLimitOptions);
    /** 受理一次尝试：检查锁定 + 并发占位，返回结算句柄（登录路径用这个）。 */
    admit(ip: string, account: string | undefined, scope?: RateLimitScope): AdmissionResult;
    /**
     * 并发闸：以「在途」数量为准，failures 只决定在途上限（锁到期后 1 条，平时 maxFailures）。
     * - 结算时 failures 才增长，锁由 lockUntil 表达；把 failures 直接并进闸门会让锁到期后
     *   仍然永久 429（failures 要等窗口衰减才归零），退避也就永远不升级。
     * - 在途上限 = maxFailures 时，一次突发最多贡献 maxFailures 次猜码，随后立即锁定；
     *   锁到期后只放 1 条探测，避免"锁一到期就再来一波"。
     */
    private reserve;
    /** 返回只允许结算一次的句柄（重复调用是空操作）。 */
    private admissionFor;
    /**
     * 只受理账号桶（不含 IP）：passkey 在解析出用户名之前只能占 IP，解析出来后再补一道
     * 账号闸，否则换 IP 就绕开了该账号的失败计数。
     */
    admitAccount(account: string, scope?: RateLimitScope): AdmissionResult;
    check(ip: string, account: string | undefined, scope?: RateLimitScope): RateLimitCheck;
    recordFailure(ip: string, account: string | undefined, scope?: RateLimitScope): void;
    /**
     * 已认证面的成功清零（改密 / 管理重置 / 管理面再认证）：清 IP 与账号两个桶。
     *
     * 登录路径**不走这里**：它们用 `admit().settle("success")`，只清账号桶、不动 IP 桶
     * （P2：换自己账号登录一次就能洗白 IP 级的撞库计数）。改密面不同：它是已认证
     * 单用户流程，成功即证明身份，继续用 IP 桶锁住操作人没有安全收益，只会把人锁在自己的
     * 表单外面。
     */
    recordSuccess(ip: string, account: string | undefined, scope?: RateLimitScope): void;
    /** 管理员重置后解锁：清该账号在所有域里的桶（IP 桶保持，理由同上）。 */
    clearAccount(account: string): void;
    /** 返还占位并按结果记账；重复结算由 admit 的闭包挡住。 */
    private release;
    /** 返回该桶当前剩余锁定毫秒数（>0 = 锁定中）；同时做窗口衰减。 */
    private waitOf;
    private decay;
    private recordBucket;
    /** 指数退避：第 n 次打击（n ≥ maxFailures）锁定 base·2^(n−maxFailures)，封顶 maxDelay。 */
    private backoff;
    private entryOf;
    private clearKey;
    private dropIdle;
    /** 删除空闲条目；条目超上限时按「最不可能再锁人」优先淘汰。 */
    private prune;
    /** 淘汰顺序：锁定最早到期、失败最少的先走；活跃的锁定桶留在表里（P2：驱逐不可被利用）。 */
    private cap;
}
