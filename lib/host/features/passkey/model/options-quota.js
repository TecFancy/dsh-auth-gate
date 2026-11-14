/** 单进程的 begin 配额；并发安全（Node 单线程，Map 更新同步）。 */
export class PasskeyOptionsQuota {
    perIpLimit;
    globalLimit;
    windowMs;
    now;
    byIp = new Map();
    global = [];
    constructor(options = {}) {
        this.perIpLimit = options.perIpLimit ?? 20;
        this.globalLimit = options.globalLimit ?? 120;
        this.windowMs = options.windowMs ?? 60_000;
        this.now = options.now ?? Date.now;
    }
    check(ip) {
        const now = this.now();
        const ipHits = this.prune(this.byIp.get(ip), now);
        if (ipHits.length > 0)
            this.byIp.set(ip, ipHits);
        else
            this.byIp.delete(ip);
        this.global = this.prune(this.global, now);
        const ipBlocked = this.blockedFor(ipHits, this.perIpLimit, now);
        if (ipBlocked !== undefined)
            return { allowed: false, retryAfterSeconds: ipBlocked };
        const globalBlocked = this.blockedFor(this.global, this.globalLimit, now);
        if (globalBlocked !== undefined)
            return { allowed: false, retryAfterSeconds: globalBlocked };
        return { allowed: true };
    }
    /** 记录一次 begin（只在 `check` 允许后调用）。 */
    consume(ip) {
        const now = this.now();
        const hits = this.byIp.get(ip) ?? [];
        hits.push(now);
        this.byIp.set(ip, hits);
        this.global.push(now);
    }
    /** 丢弃窗口外的命中，返回窗口内的（保持插入顺序）。 */
    prune(hits, now) {
        if (hits === undefined)
            return [];
        const cutoff = now - this.windowMs;
        return hits.filter((at) => at > cutoff);
    }
    /** 已达上限时给出最早一条命中滑出窗口所需秒数；未达上限返回 undefined。 */
    blockedFor(hits, limit, now) {
        if (hits.length < limit)
            return undefined;
        const oldest = hits[hits.length - limit] ?? hits[0] ?? now;
        return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
    }
}
//# sourceMappingURL=options-quota.js.map