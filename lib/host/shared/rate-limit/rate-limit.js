import { acctKeyOf, keyOf, SCOPES, } from "./types.js";
const IDLE_LIMIT = 10_000;
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
// TODO(auth-m5): persist limiter across restart (T13/D8).
export class LoginRateLimiter {
    maxFailures;
    baseDelayMs;
    maxDelayMs;
    windowMs;
    maxConcurrentPerIp;
    now;
    byIp = new Map();
    byAccount = new Map();
    /** admit 计数：prune 是 O(n)，分摊到每 64 次受理一次，避免每个请求全表扫描。 */
    admitsSincePrune = 0;
    constructor(options = {}) {
        this.maxFailures = options.maxFailures ?? 5;
        this.baseDelayMs = (options.baseDelaySeconds ?? 30) * 1000;
        this.maxDelayMs = (options.maxDelaySeconds ?? 900) * 1000;
        this.windowMs = (options.windowSeconds ?? 600) * 1000;
        this.maxConcurrentPerIp = options.maxConcurrentPerIp ?? 32;
        this.now = options.now ?? Date.now;
    }
    /** 受理一次尝试：检查锁定 + 并发占位，返回结算句柄（登录路径用这个）。 */
    admit(ip, account, scope = "login") {
        const now = this.now();
        const ipKey = keyOf(scope, ip);
        const acctKey = account === undefined || account === "" ? undefined : keyOf(scope, account);
        const wait = Math.max(this.waitOf(this.byIp, ipKey, now), acctKey === undefined ? 0 : this.waitOf(this.byAccount, acctKey, now));
        if (wait > 0)
            return { admitted: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
        const rejected = this.reserve(ipKey, acctKey);
        if (rejected !== undefined)
            return rejected;
        this.admitsSincePrune += 1;
        if (this.admitsSincePrune >= 64) {
            this.admitsSincePrune = 0;
            this.prune(now);
        }
        return { admitted: true, admission: this.admissionFor(ipKey, acctKey) };
    }
    /**
     * 并发闸：以「在途」数量为准，failures 只决定在途上限（锁到期后 1 条，平时 maxFailures）。
     * - 结算时 failures 才增长，锁由 lockUntil 表达；把 failures 直接并进闸门会让锁到期后
     *   仍然永久 429（failures 要等窗口衰减才归零），退避也就永远不升级。
     * - 在途上限 = maxFailures 时，一次突发最多贡献 maxFailures 次猜码，随后立即锁定；
     *   锁到期后只放 1 条探测，避免"锁一到期就再来一波"。
     */
    reserve(ipKey, acctKey) {
        const ipEntry = this.byIp.get(ipKey);
        if (ipEntry !== undefined && ipEntry.inflight >= this.maxConcurrentPerIp) {
            return { admitted: false, retryAfterSeconds: 1 };
        }
        const acctEntry = acctKey === undefined ? undefined : this.byAccount.get(acctKey);
        if (acctEntry !== undefined) {
            // 锁到期后只放 1 条探测（突发并发不能一次贡献 maxFailures 次猜码）。
            const cap = acctEntry.failures >= this.maxFailures ? 1 : this.maxFailures;
            if (acctEntry.inflight >= cap)
                return { admitted: false, retryAfterSeconds: 1 };
        }
        const trackedIp = ipEntry ?? this.entryOf(this.byIp, ipKey);
        const trackedAcct = acctKey === undefined ? undefined : (acctEntry ?? this.entryOf(this.byAccount, acctKey));
        trackedIp.inflight += 1;
        if (trackedAcct !== undefined)
            trackedAcct.inflight += 1;
        return undefined;
    }
    /** 返回只允许结算一次的句柄（重复调用是空操作）。 */
    admissionFor(ipKey, acctKey) {
        let settled = false;
        return {
            settle: (outcome, account) => {
                if (settled)
                    return;
                settled = true;
                this.release(ipKey, acctKey, outcome, account);
            },
        };
    }
    /**
     * 只受理账号桶（不含 IP）：passkey 在解析出用户名之前只能占 IP，解析出来后再补一道
     * 账号闸，否则换 IP 就绕开了该账号的失败计数。
     */
    admitAccount(account, scope = "login") {
        const now = this.now();
        const key = keyOf(scope, account);
        const wait = this.waitOf(this.byAccount, key, now);
        if (wait > 0) {
            return { admitted: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
        }
        const entry = this.byAccount.get(key);
        // 锁到期后的第一次尝试最多放 1 条（不是 maxFailures 条）：突发探测只能算一次猜码。
        const cap = entry !== undefined && entry.failures >= this.maxFailures ? 1 : this.maxFailures;
        if (entry !== undefined && entry.inflight >= cap) {
            return { admitted: false, retryAfterSeconds: 1 };
        }
        const tracked = entry ?? this.entryOf(this.byAccount, key);
        tracked.inflight += 1;
        let settled = false;
        return {
            admitted: true,
            admission: {
                settle: (outcome) => {
                    if (settled)
                        return;
                    settled = true;
                    const current = this.byAccount.get(key);
                    if (current !== undefined)
                        current.inflight = Math.max(0, current.inflight - 1);
                    if (outcome === "failure")
                        this.recordBucket(this.byAccount, key, this.now());
                    else if (outcome === "success")
                        this.clearKey(this.byAccount, key);
                    this.dropIdle(this.byAccount, key);
                },
            },
        };
    }
    check(ip, account, scope = "login") {
        const now = this.now();
        const locked = Math.max(this.waitOf(this.byIp, keyOf(scope, ip), now), account === undefined || account === ""
            ? 0
            : this.waitOf(this.byAccount, keyOf(scope, account), now));
        if (locked > 0) {
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(locked / 1000)) };
        }
        this.prune(now);
        return { allowed: true };
    }
    recordFailure(ip, account, scope = "login") {
        const now = this.now();
        this.recordBucket(this.byIp, keyOf(scope, ip), now);
        if (account !== undefined && account !== "") {
            this.recordBucket(this.byAccount, keyOf(scope, account), now);
        }
    }
    /**
     * 已认证面的成功清零（改密 / 管理重置 / 管理面再认证）：清 IP 与账号两个桶。
     *
     * 登录路径**不走这里**：它们用 `admit().settle("success")`，只清账号桶、不动 IP 桶
     * （P2：换自己账号登录一次就能洗白 IP 级的撞库计数）。改密面不同：它是已认证
     * 单用户流程，成功即证明身份，继续用 IP 桶锁住操作人没有安全收益，只会把人锁在自己的
     * 表单外面。
     */
    recordSuccess(ip, account, scope = "login") {
        this.clearKey(this.byIp, keyOf(scope, ip));
        if (account !== undefined && account !== "") {
            this.clearKey(this.byAccount, keyOf(scope, account));
        }
    }
    /** 管理员重置后解锁：清该账号在所有域里的桶（IP 桶保持，理由同上）。 */
    clearAccount(account) {
        if (account === "")
            return;
        for (const scope of SCOPES)
            this.clearKey(this.byAccount, keyOf(scope, account));
    }
    /** 返还占位并按结果记账；重复结算由 admit 的闭包挡住。 */
    release(ipKey, acctKey, outcome, account) {
        const now = this.now();
        const ipEntry = this.byIp.get(ipKey);
        if (ipEntry !== undefined)
            ipEntry.inflight = Math.max(0, ipEntry.inflight - 1);
        const acctEntry = acctKey === undefined ? undefined : this.byAccount.get(acctKey);
        if (acctEntry !== undefined)
            acctEntry.inflight = Math.max(0, acctEntry.inflight - 1);
        if (outcome === "failure") {
            this.recordBucket(this.byIp, ipKey, now);
            if (acctKey !== undefined)
                this.recordBucket(this.byAccount, acctKey, now);
        }
        else if (outcome === "success" && acctKey !== undefined) {
            this.clearKey(this.byAccount, acctKey);
        }
        // 受理时未带账号、结算时才解析出来的（passkey）：补记/清理账号桶。
        if (account !== undefined && account !== "" && acctKey === undefined) {
            const key = acctKeyOf(ipKey, account);
            if (outcome === "failure")
                this.recordBucket(this.byAccount, key, now);
            else if (outcome === "success")
                this.clearKey(this.byAccount, key);
            this.dropIdle(this.byAccount, key);
        }
        this.dropIdle(this.byIp, ipKey);
        if (acctKey !== undefined)
            this.dropIdle(this.byAccount, acctKey);
    }
    /** 返回该桶当前剩余锁定毫秒数（>0 = 锁定中）；同时做窗口衰减。 */
    waitOf(bucket, key, now) {
        const entry = bucket.get(key);
        if (entry === undefined)
            return 0;
        if (entry.lockUntil > now)
            return entry.lockUntil - now;
        this.decay(entry, now);
        this.dropIdle(bucket, key);
        return 0;
    }
    decay(entry, now) {
        // 锁定中的桶永远不衰减：900s 锁配 600s 窗口时，衰减会把锁提前解掉（P2）。
        if (entry.lockUntil > now)
            return;
        if (entry.lastFailureAt > 0 && now - entry.lastFailureAt > this.windowMs) {
            entry.failures = 0;
            entry.strikes = 0;
            entry.lockUntil = 0;
        }
    }
    recordBucket(bucket, key, now) {
        const entry = this.entryOf(bucket, key);
        entry.failures += 1;
        entry.strikes += 1;
        entry.lastFailureAt = now;
        if (entry.failures >= this.maxFailures)
            entry.lockUntil = now + this.backoff(entry.strikes);
    }
    /** 指数退避：第 n 次打击（n ≥ maxFailures）锁定 base·2^(n−maxFailures)，封顶 maxDelay。 */
    backoff(strikes) {
        const exponent = Math.max(0, strikes - this.maxFailures);
        return Math.min(this.baseDelayMs * 2 ** exponent, this.maxDelayMs);
    }
    entryOf(bucket, key) {
        const existing = bucket.get(key);
        if (existing !== undefined)
            return existing;
        const created = {
            failures: 0,
            strikes: 0,
            inflight: 0,
            lockUntil: 0,
            lastFailureAt: 0,
        };
        bucket.set(key, created);
        return created;
    }
    clearKey(bucket, key) {
        const entry = bucket.get(key);
        if (entry === undefined)
            return;
        entry.failures = 0;
        entry.strikes = 0;
        entry.lockUntil = 0;
        if (entry.inflight === 0)
            bucket.delete(key);
    }
    dropIdle(bucket, key) {
        const entry = bucket.get(key);
        if (entry === undefined)
            return;
        if (entry.failures === 0 && entry.strikes === 0 && entry.inflight === 0)
            bucket.delete(key);
    }
    /** 删除空闲条目；条目超上限时按「最不可能再锁人」优先淘汰。 */
    prune(now) {
        for (const [key, entry] of this.byIp) {
            this.decay(entry, now);
            this.dropIdle(this.byIp, key);
        }
        for (const [key, entry] of this.byAccount) {
            this.decay(entry, now);
            this.dropIdle(this.byAccount, key);
        }
        this.cap(this.byIp);
        this.cap(this.byAccount);
    }
    /** 淘汰顺序：锁定最早到期、失败最少的先走；活跃的锁定桶留在表里（P2：驱逐不可被利用）。 */
    cap(bucket) {
        if (bucket.size <= IDLE_LIMIT)
            return;
        // 在途条目（淘汰会让释放逻辑找不到桶）与仍在锁定的条目（淘汰等于提前解封）都不参与淘汰；
        // 若全表都是活锁，宁可暂时超出软上限，也不删任何一把锁。
        const ranked = [...bucket.entries()]
            .filter(([, entry]) => entry.inflight === 0 && entry.lockUntil <= this.now())
            .sort((a, b) => a[1].lockUntil - b[1].lockUntil ||
            a[1].failures - b[1].failures ||
            a[0].localeCompare(b[0]));
        const target = Math.floor(IDLE_LIMIT * 0.9);
        for (const [key] of ranked.slice(0, bucket.size - target))
            bucket.delete(key);
    }
}
