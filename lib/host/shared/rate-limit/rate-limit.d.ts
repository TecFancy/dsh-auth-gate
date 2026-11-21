export interface RateLimitOptions {
    /** 连续失败多少次后进入锁定。默认 5。 */
    maxFailures?: number;
    /** 首次锁定的基础时长（秒），此后按 2 的幂增长。默认 30。 */
    baseDelaySeconds?: number;
    /** 锁定上限（秒）。默认 900。 */
    maxDelaySeconds?: number;
    /** 失败计数衰减窗口（秒）：窗口内无新失败即清零。默认 600。 */
    windowSeconds?: number;
    /** 同一 IP 同时在途的登录尝试上限（并发突发保护，与失败阈值解耦）。默认 32。 */
    maxConcurrentPerIp?: number;
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
 * 限速命名空间：口令、TOTP、passkey 与 token 各自计数，互不清除。
 * P1.2 之前 TOTP 与口令共用 `(ip, username)` 桶，一次正确口令就把第二因子的
 * 猜码计数清零；分域后只有完整登录成功才清对应域的账号桶。
 */
export type RateLimitScope = "login" | "totp" | "passkey" | "token" | "password-change" | "admin";
/** 一次已受理尝试的凭据；只允许结算一次（重复调用是空操作）。 */
export interface Admission {
    /**
     * 结算。`account` 是受理时还不知道、结算时才确认的账号（passkey finish 从断言里才解析出
     * 用户）：失败记到该账号桶，成功清该账号桶。口令/TOTP/token 路径受理时已知账号，不必传。
     */
    settle(outcome: "success" | "failure" | "abandon", account?: string): void;
}
export type AdmissionResult = {
    admitted: true;
    admission: Admission;
} | {
    admitted: false;
    retryAfterSeconds: number;
};
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
    constructor(options?: RateLimitOptions);
    /** 受理一次尝试：检查锁定 + 并发占位，返回结算句柄（登录路径用这个）。 */
    admit(ip: string, account: string | undefined, scope?: RateLimitScope): AdmissionResult;
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
