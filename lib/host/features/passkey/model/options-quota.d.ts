/**
 * `POST /auth/passkey/options` 的请求配额（滑动窗口，进程内）。
 *
 * ceremony 有 1024 条上限与 120 秒 TTL，但**上限本身不防驱逐**：匿名方可反复 begin，把他人
 * 在途仪式挤出存储（plan §5.5）。因此 begin 必须真正消耗配额，而不是复用「验证失败才计数」
 * 的登录限速器：
 * - 每个客户端 IP 独立窗口（缺省 20 次/60 秒）；
 * - 全局限流窗口（缺省 120 次/60 秒），断电更换 IP 的攻击面；
 * - `check` 只判定、`consume` 才计数（429 的那次不消耗配额，也不创建 ceremony）。
 *
 * 进程内、无定时器：过期条目在 `check`/`consume` 时按需清理；重启清零（与 `LoginRateLimiter`
 * 同语义）。配额是可用性护栏，不是认证边界。
 */
export interface PasskeyOptionsQuotaOptions {
    /** 单 IP 窗口内允许的 begin 次数（缺省 20）。 */
    readonly perIpLimit?: number;
    /** 全部 IP 合计的窗口内允许次数（缺省 120）。 */
    readonly globalLimit?: number;
    /** 滑动窗口长度（毫秒，缺省 60_000）。 */
    readonly windowMs?: number;
    /** 时钟（毫秒 epoch；测试注入）。 */
    readonly now?: () => number;
}
/** `check` 结论：拒绝时给出建议的 `retry-after` 秒数（至少 1）。 */
export type PasskeyOptionsQuotaCheck = {
    readonly allowed: true;
} | {
    readonly allowed: false;
    readonly retryAfterSeconds: number;
};
/** 单进程的 begin 配额；并发安全（Node 单线程，Map 更新同步）。 */
export declare class PasskeyOptionsQuota {
    private readonly perIpLimit;
    private readonly globalLimit;
    private readonly windowMs;
    private readonly now;
    private readonly byIp;
    private global;
    constructor(options?: PasskeyOptionsQuotaOptions);
    check(ip: string): PasskeyOptionsQuotaCheck;
    /** 记录一次 begin（只在 `check` 允许后调用）。 */
    consume(ip: string): void;
    /** 丢弃窗口外的命中，返回窗口内的（保持插入顺序）。 */
    private prune;
    /** 已达上限时给出最早一条命中滑出窗口所需秒数；未达上限返回 undefined。 */
    private blockedFor;
}
//# sourceMappingURL=options-quota.d.ts.map