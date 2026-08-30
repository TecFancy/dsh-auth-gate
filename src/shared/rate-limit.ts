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

export type RateLimitCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface BucketEntry {
  failures: number;
  lockUntil: number;
  lastFailureAt: number;
}

/**
 * 登录限速器（P10）：IP + 账号双桶、失败指数退避、窗口衰减、条目上限。
 * 内存态：重启清零；端点锁定期不调 recordFailure（429 短路，锁不被延长）。
 */
export class LoginRateLimiter {
  private readonly maxFailures: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly byIp = new Map<string, BucketEntry>();
  private readonly byAccount = new Map<string, BucketEntry>();

  constructor(options: RateLimitOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.baseDelayMs = (options.baseDelaySeconds ?? 30) * 1000;
    this.maxDelayMs = (options.maxDelaySeconds ?? 900) * 1000;
    this.windowMs = (options.windowSeconds ?? 600) * 1000;
    this.now = options.now ?? Date.now;
  }

  check(ip: string, account: string | undefined): RateLimitCheck {
    const now = this.now();
    const locked = Math.max(
      this.checkBucket(this.byIp, ip, now),
      account === undefined || account === "" ? 0 : this.checkBucket(this.byAccount, account, now),
    );
    if (locked > 0) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(locked / 1000)) };
    }
    this.prune(now);
    return { allowed: true };
  }

  recordFailure(ip: string, account: string | undefined): void {
    const now = this.now();
    this.recordBucket(this.byIp, ip, now);
    if (account !== undefined && account !== "") {
      this.recordBucket(this.byAccount, account, now);
    }
  }

  recordSuccess(ip: string, account: string | undefined): void {
    this.byIp.delete(ip);
    if (account !== undefined && account !== "") {
      this.byAccount.delete(account);
    }
  }

  /** 返回该桶当前剩余锁定毫秒数（>0 = 锁定中）；同时做锁到期/窗口衰减清零。 */
  private checkBucket(bucket: Map<string, BucketEntry>, key: string, now: number): number {
    const entry = bucket.get(key);
    if (entry === undefined) return 0;
    if (entry.lockUntil > now) return entry.lockUntil - now;
    if (entry.failures > 0 && now - entry.lastFailureAt > this.windowMs) {
      entry.failures = 0;
    }
    if (entry.failures > 0 && entry.lockUntil > 0) {
      entry.failures = 0; // 锁已到期：清零重计
    }
    if (entry.failures === 0) bucket.delete(key);
    return 0;
  }

  private recordBucket(bucket: Map<string, BucketEntry>, key: string, now: number): void {
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
  private prune(now: number): void {
    for (const [key, entry] of this.byIp) {
      if (entry.failures === 0 && entry.lockUntil <= now) this.byIp.delete(key);
    }
    for (const [key, entry] of this.byAccount) {
      if (entry.failures === 0 && entry.lockUntil <= now) this.byAccount.delete(key);
    }
    this.cap(this.byIp);
    this.cap(this.byAccount);
  }

  private cap(bucket: Map<string, BucketEntry>): void {
    while (bucket.size > 10_000) {
      const oldest = bucket.keys().next().value;
      if (oldest === undefined) return;
      bucket.delete(oldest);
    }
  }
}
