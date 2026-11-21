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

export type RateLimitCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

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

export type AdmissionResult =
  { admitted: true; admission: Admission } | { admitted: false; retryAfterSeconds: number };

interface BucketEntry {
  /** 窗口内连续失败数；决定是否进入锁定。 */
  failures: number;
  /** 累计打击数；跨锁到期保留，决定退避指数（P1.2：退避必须真的升级）。 */
  strikes: number;
  /** 已受理未结算的尝试。计入准入，堵住并发突发绕过（P1.3）。 */
  inflight: number;
  lockUntil: number;
  lastFailureAt: number;
}

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
  private readonly maxFailures: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly windowMs: number;
  private readonly maxConcurrentPerIp: number;
  private readonly now: () => number;
  private readonly byIp = new Map<string, BucketEntry>();
  private readonly byAccount = new Map<string, BucketEntry>();

  constructor(options: RateLimitOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.baseDelayMs = (options.baseDelaySeconds ?? 30) * 1000;
    this.maxDelayMs = (options.maxDelaySeconds ?? 900) * 1000;
    this.windowMs = (options.windowSeconds ?? 600) * 1000;
    this.maxConcurrentPerIp = options.maxConcurrentPerIp ?? 32;
    this.now = options.now ?? Date.now;
  }

  /** 受理一次尝试：检查锁定 + 并发占位，返回结算句柄（登录路径用这个）。 */
  admit(ip: string, account: string | undefined, scope: RateLimitScope = "login"): AdmissionResult {
    const now = this.now();
    const ipKey = keyOf(scope, ip);
    const acctKey = account === undefined || account === "" ? undefined : keyOf(scope, account);
    const wait = Math.max(
      this.waitOf(this.byIp, ipKey, now),
      acctKey === undefined ? 0 : this.waitOf(this.byAccount, acctKey, now),
    );
    if (wait > 0)
      return { admitted: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };

    const ipEntry = this.entryOf(this.byIp, ipKey);
    if (ipEntry.failures + ipEntry.inflight >= this.maxConcurrentPerIp) {
      return { admitted: false, retryAfterSeconds: 1 };
    }
    const acctEntry = acctKey === undefined ? undefined : this.entryOf(this.byAccount, acctKey);
    if (acctEntry !== undefined && acctEntry.failures + acctEntry.inflight >= this.maxFailures) {
      return { admitted: false, retryAfterSeconds: 1 };
    }
    ipEntry.inflight += 1;
    if (acctEntry !== undefined) acctEntry.inflight += 1;
    this.prune(now);
    let settled = false;
    return {
      admitted: true,
      admission: {
        settle: (outcome, account) => {
          if (settled) return;
          settled = true;
          this.release(ipKey, acctKey, outcome, account);
        },
      },
    };
  }

  check(ip: string, account: string | undefined, scope: RateLimitScope = "login"): RateLimitCheck {
    const now = this.now();
    const locked = Math.max(
      this.waitOf(this.byIp, keyOf(scope, ip), now),
      account === undefined || account === ""
        ? 0
        : this.waitOf(this.byAccount, keyOf(scope, account), now),
    );
    if (locked > 0) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(locked / 1000)) };
    }
    this.prune(now);
    return { allowed: true };
  }

  recordFailure(ip: string, account: string | undefined, scope: RateLimitScope = "login"): void {
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
  recordSuccess(ip: string, account: string | undefined, scope: RateLimitScope = "login"): void {
    this.clearKey(this.byIp, keyOf(scope, ip));
    if (account !== undefined && account !== "") {
      this.clearKey(this.byAccount, keyOf(scope, account));
    }
  }

  /** 管理员重置后解锁：清该账号在所有域里的桶（IP 桶保持，理由同上）。 */
  clearAccount(account: string): void {
    if (account === "") return;
    for (const scope of SCOPES) this.clearKey(this.byAccount, keyOf(scope, account));
  }

  /** 返还占位并按结果记账；重复结算由 admit 的闭包挡住。 */
  private release(
    ipKey: string,
    acctKey: string | undefined,
    outcome: "success" | "failure" | "abandon",
    account?: string,
  ): void {
    const now = this.now();
    const ipEntry = this.byIp.get(ipKey);
    if (ipEntry !== undefined) ipEntry.inflight = Math.max(0, ipEntry.inflight - 1);
    const acctEntry = acctKey === undefined ? undefined : this.byAccount.get(acctKey);
    if (acctEntry !== undefined) acctEntry.inflight = Math.max(0, acctEntry.inflight - 1);
    if (outcome === "failure") {
      this.recordBucket(this.byIp, ipKey, now);
      if (acctKey !== undefined) this.recordBucket(this.byAccount, acctKey, now);
    } else if (outcome === "success" && acctKey !== undefined) {
      this.clearKey(this.byAccount, acctKey);
    }
    // 受理时未带账号、结算时才解析出来的（passkey）：补记/清理账号桶。
    if (account !== undefined && account !== "" && acctKey === undefined) {
      const key = acctKeyOf(ipKey, account);
      if (outcome === "failure") this.recordBucket(this.byAccount, key, now);
      else if (outcome === "success") this.clearKey(this.byAccount, key);
      this.dropIdle(this.byAccount, key);
    }
    this.dropIdle(this.byIp, ipKey);
    if (acctKey !== undefined) this.dropIdle(this.byAccount, acctKey);
  }

  /** 返回该桶当前剩余锁定毫秒数（>0 = 锁定中）；同时做窗口衰减。 */
  private waitOf(bucket: Map<string, BucketEntry>, key: string, now: number): number {
    const entry = bucket.get(key);
    if (entry === undefined) return 0;
    if (entry.lockUntil > now) return entry.lockUntil - now;
    this.decay(entry, now);
    this.dropIdle(bucket, key);
    return 0;
  }

  private decay(entry: BucketEntry, now: number): void {
    if (entry.lastFailureAt > 0 && now - entry.lastFailureAt > this.windowMs) {
      entry.failures = 0;
      entry.strikes = 0;
      entry.lockUntil = 0;
    }
  }

  private recordBucket(bucket: Map<string, BucketEntry>, key: string, now: number): void {
    const entry = this.entryOf(bucket, key);
    entry.failures += 1;
    entry.strikes += 1;
    entry.lastFailureAt = now;
    if (entry.failures >= this.maxFailures) entry.lockUntil = now + this.backoff(entry.strikes);
  }

  /** 指数退避：第 n 次打击（n ≥ maxFailures）锁定 base·2^(n−maxFailures)，封顶 maxDelay。 */
  private backoff(strikes: number): number {
    const exponent = Math.max(0, strikes - this.maxFailures);
    return Math.min(this.baseDelayMs * 2 ** exponent, this.maxDelayMs);
  }

  private entryOf(bucket: Map<string, BucketEntry>, key: string): BucketEntry {
    const existing = bucket.get(key);
    if (existing !== undefined) return existing;
    const created: BucketEntry = {
      failures: 0,
      strikes: 0,
      inflight: 0,
      lockUntil: 0,
      lastFailureAt: 0,
    };
    bucket.set(key, created);
    return created;
  }

  private clearKey(bucket: Map<string, BucketEntry>, key: string): void {
    const entry = bucket.get(key);
    if (entry === undefined) return;
    entry.failures = 0;
    entry.strikes = 0;
    entry.lockUntil = 0;
    if (entry.inflight === 0) bucket.delete(key);
  }

  private dropIdle(bucket: Map<string, BucketEntry>, key: string): void {
    const entry = bucket.get(key);
    if (entry === undefined) return;
    if (entry.failures === 0 && entry.strikes === 0 && entry.inflight === 0) bucket.delete(key);
  }

  /** 删除空闲条目；条目超上限时按「最不可能再锁人」优先淘汰。 */
  private prune(now: number): void {
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
  private cap(bucket: Map<string, BucketEntry>): void {
    if (bucket.size <= IDLE_LIMIT) return;
    // 仍在途的条目（inflight > 0）不参与淘汰：淘汰它会让释放逻辑找不到桶。
    const ranked = [...bucket.entries()]
      .filter(([, entry]) => entry.inflight === 0)
      .sort(
        (a, b) =>
          a[1].lockUntil - b[1].lockUntil ||
          a[1].failures - b[1].failures ||
          a[0].localeCompare(b[0]),
      );
    const target = Math.floor(IDLE_LIMIT * 0.9);
    for (const [key] of ranked.slice(0, bucket.size - target)) bucket.delete(key);
  }
}

const SCOPES: readonly RateLimitScope[] = [
  "login",
  "totp",
  "passkey",
  "token",
  "password-change",
  "admin",
];

function keyOf(scope: RateLimitScope, value: string): string {
  return `${scope}\u0000${value}`;
}

/** 从已拼好的 IP 键（`scope\u0000value`）还原同一域的账号键。 */
function acctKeyOf(ipKey: string, account: string): string {
  return `${ipKey.slice(0, ipKey.indexOf("\u0000"))}\u0000${account}`;
}
