/**
 * 登录限速器（P10）：IP + 账号双桶、失败指数退避、窗口衰减、条目上限。
 * 内存态：重启清零；端点锁定期不调 recordFailure（429 短路，锁不被延长）。
 */
// TODO(auth-m5): persist limiter across restart (T13/D8).
export class LoginRateLimiter {
    maxFailures;
    baseDelayMs;
    maxDelayMs;
    windowMs;
    now;
    byIp = new Map();
    byAccount = new Map();
    constructor(options = {}) {
        this.maxFailures = options.maxFailures ?? 5;
        this.baseDelayMs = (options.baseDelaySeconds ?? 30) * 1000;
        this.maxDelayMs = (options.maxDelaySeconds ?? 900) * 1000;
        this.windowMs = (options.windowSeconds ?? 600) * 1000;
        this.now = options.now ?? Date.now;
    }
    check(ip, account) {
        const now = this.now();
        const locked = Math.max(this.checkBucket(this.byIp, ip, now), account === undefined || account === "" ? 0 : this.checkBucket(this.byAccount, account, now));
        if (locked > 0) {
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(locked / 1000)) };
        }
        this.prune(now);
        return { allowed: true };
    }
    recordFailure(ip, account) {
        const now = this.now();
        this.recordBucket(this.byIp, ip, now);
        if (account !== undefined && account !== "") {
            this.recordBucket(this.byAccount, account, now);
        }
    }
    recordSuccess(ip, account) {
        this.byIp.delete(ip);
        if (account !== undefined && account !== "") {
            this.byAccount.delete(account);
        }
    }
    /** 返回该桶当前剩余锁定毫秒数（>0 = 锁定中）；同时做锁到期/窗口衰减清零。 */
    checkBucket(bucket, key, now) {
        const entry = bucket.get(key);
        if (entry === undefined)
            return 0;
        if (entry.lockUntil > now)
            return entry.lockUntil - now;
        if (entry.failures > 0 && now - entry.lastFailureAt > this.windowMs) {
            entry.failures = 0;
        }
        if (entry.failures > 0 && entry.lockUntil > 0) {
            entry.failures = 0; // 锁已到期：清零重计
        }
        if (entry.failures === 0)
            bucket.delete(key);
        return 0;
    }
    recordBucket(bucket, key, now) {
        const entry = bucket.get(key) ?? { failures: 0, lockUntil: 0, lastFailureAt: 0 };
        entry.failures += 1;
        entry.lastFailureAt = now;
        if (entry.failures >= this.maxFailures) {
            const exponent = entry.failures - this.maxFailures;
            const delay = Math.min(this.baseDelayMs * 2 ** exponent, this.maxDelayMs);
            entry.lockUntil = now + delay;
        }
        bucket.set(key, entry);
    }
    /** 删除清零条目；条目超 10000 时删除最早插入的（Map 迭代序）。 */
    prune(now) {
        for (const [key, entry] of this.byIp) {
            if (entry.failures === 0 && entry.lockUntil <= now)
                this.byIp.delete(key);
        }
        for (const [key, entry] of this.byAccount) {
            if (entry.failures === 0 && entry.lockUntil <= now)
                this.byAccount.delete(key);
        }
        this.cap(this.byIp);
        this.cap(this.byAccount);
    }
    cap(bucket) {
        while (bucket.size > 10_000) {
            const oldest = bucket.keys().next().value;
            if (oldest === undefined)
                return;
            bucket.delete(oldest);
        }
    }
}
//# sourceMappingURL=rate-limit.js.map