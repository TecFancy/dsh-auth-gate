/**
 * 限速器的公共类型与键工具：从 `rate-limit.ts` 拆出守住单文件行数上限。
 * 语义文档见 `rate-limit.ts`（类）、Agent Note D39 与共享出口封顶那条 note。
 */

export interface RateLimitOptions {
  /** 连续失败多少次后进入锁定。默认 5。 */
  maxFailures?: number;
  /** 首次锁定的基础时长（秒），此后按 2 的幂增长。默认 30。 */
  baseDelaySeconds?: number;
  /** 锁定上限（秒）。默认 900。账号桶用这个封顶。 */
  maxDelaySeconds?: number;
  /**
   * IP 桶单独的锁定上限（秒）。默认 120，且不超过 `maxDelaySeconds`。
   *
   * 共享出口地址（办公室 NAT、移动 CGNAT、VPN 出口）上一个地址就是一整批用户，所以对
   * 「地址」升级锁惩罚的是旁观者而不是攻击者；账号桶仍按 `maxDelaySeconds` 升级。见
   * Agent Note 2026-11-26-shared-egress-lockout-ceiling。
   */
  ipMaxDelaySeconds?: number;
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

export interface BucketEntry {
  /** 窗口内连续失败数；决定是否进入锁定。 */
  failures: number;
  /** 累计打击数；跨锁到期保留，决定退避指数（P1.2：退避必须真的升级）。 */
  strikes: number;
  /** 已受理未结算的尝试。计入准入，堵住并发突发绕过（P1.3）。 */
  inflight: number;
  lockUntil: number;
  lastFailureAt: number;
}

/** 每个域的桶键：`scope\u0000value`。 */
export function keyOf(scope: RateLimitScope, value: string): string {
  return `${scope}\u0000${value}`;
}

/** 从已拼好的 IP 键（`scope\u0000value`）还原同一域的账号键。 */
export function acctKeyOf(ipKey: string, account: string): string {
  return `${ipKey.slice(0, ipKey.indexOf("\u0000"))}\u0000${account}`;
}

export const SCOPES: readonly RateLimitScope[] = [
  "login",
  "totp",
  "passkey",
  "token",
  "password-change",
  "admin",
];

/**
 * 把一个账号闸并入已有的 IP 受理句柄：结算时两个都结算，重复调用由各自挡住。
 * passkey 的流程是「先占 IP，解析出用户后再占账号」，调用方只需继续使用合并后的句柄。
 */
export function combineAdmissions(primary: Admission, secondary: Admission): Admission {
  return {
    settle: (outcome) => {
      // account 只交给 secondary：primary 在受理时没有账号，传 account 会让它在释放时
      // 再记一次账号桶，等于每次失败计两次（P2）。
      primary.settle(outcome);
      secondary.settle(outcome);
    },
  };
}
