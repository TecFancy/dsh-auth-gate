import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "./rate-limit.js";

function makeLimiter(): { limiter: LoginRateLimiter; advance: (ms: number) => void } {
  let now = 1_000_000;
  const limiter = new LoginRateLimiter({ now: () => now });
  return {
    limiter,
    advance: (ms) => {
      now += ms;
    },
  };
}

function fail(
  limiter: LoginRateLimiter,
  ip: string,
  account?: string,
  scope: "login" | "totp" | "passkey" | "token" | "password-change" | "admin" = "login",
): void {
  limiter.recordFailure(ip, account, scope);
}

describe("LoginRateLimiter lockout sequence", () => {
  it("stays allowed for the first maxFailures-1 failures", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 4; i++) {
      fail(limiter, "1.2.3.4", "alice");
      expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
    }
  });

  it("locks for baseDelaySeconds after the 5th failure", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});

describe("LoginRateLimiter lockout escalation", () => {
  it("doubles the lockout per extra failure and caps at maxDelaySeconds", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 6; i++) fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    for (let i = 0; i < 10; i++) fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
  });

  it("stays locked while the lockout is active", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice");
    advance(29_000);
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    advance(2_000);
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
  });

  it("keeps escalating across a lock that expired (P1.2: strikes survive)", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice");
    advance(30_001); // 锁到期：允许下一次尝试
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
    fail(limiter, "1.2.3.4", "alice");
    // 第 6 次打击：30s × 2 = 60s，而不是回到 30s
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    advance(60_001);
    fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 120,
    });
  });

  it("forgets strikes only after the decay window without failures", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice");
    advance(600_001);
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});

describe("LoginRateLimiter success semantics", () => {
  it("clears both buckets on an authenticated success (password change / admin)", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 4; i++) fail(limiter, "1.2.3.4", "alice");
    limiter.recordSuccess("1.2.3.4", "alice");
    fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
  });

  it("a login success does not clear the IP bucket (P2: no get-out-of-jail card)", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 4; i++) fail(limiter, "1.2.3.4", "alice");
    const admitted = limiter.admit("1.2.3.4", "bob");
    if (!admitted.admitted) throw new Error("expected admission");
    admitted.admission.settle("success");
    // bob 的账号桶清了，但 IP 桶仍是 4：再失败一次就锁整个 IP
    fail(limiter, "1.2.3.4", "carol");
    expect(limiter.check("1.2.3.4", "dave")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});

describe("LoginRateLimiter scopes", () => {
  it("does not clear the TOTP bucket when the password stage succeeds (P1: TOTP cap)", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 4; i++) fail(limiter, "1.2.3.4", "alice");
    limiter.recordSuccess("1.2.3.4", "alice", "login");
    // TOTP 域独立：口令域清零不影响 TOTP 域
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice", "totp");
    expect(limiter.check("1.2.3.4", "alice", "totp")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(limiter.check("1.2.3.4", "alice", "login")).toEqual({ allowed: true });
  });

  it("keeps passkey and password failures apart", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice", "passkey");
    expect(limiter.check("1.2.3.4", "alice", "passkey")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(limiter.check("1.2.3.4", "alice", "login")).toEqual({ allowed: true });
  });

  it("clearAccount unlocks the account in every scope but leaves IP buckets alone", () => {
    const { limiter } = makeLimiter();
    // 五个不同 IP 各失败一次：账号桶到 5，IP 桶各 1
    for (let i = 0; i < 5; i++) fail(limiter, `ip-${i}`, "alice", "totp");
    expect(limiter.check("ip-x", "alice", "totp")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    limiter.clearAccount("alice");
    expect(limiter.check("ip-x", "alice", "totp")).toEqual({ allowed: true });
    expect(limiter.check("ip-x", "alice", "login")).toEqual({ allowed: true });
    // IP 桶不受影响
    expect(limiter.check("ip-0", "bob", "login")).toEqual({ allowed: true });
  });
});

describe("LoginRateLimiter bucket isolation", () => {
  it("keeps the IP bucket independent from the account bucket", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice");
    // 同 IP 不同账号：被 IP 桶锁
    expect(limiter.check("1.2.3.4", "bob")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    // 不同 IP 同一账号：被账号桶锁
    expect(limiter.check("5.6.7.8", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    // 都无关
    expect(limiter.check("5.6.7.8", "bob")).toEqual({ allowed: true });
  });

  it("only touches the IP bucket when account is undefined or empty", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", undefined);
    expect(limiter.check("1.2.3.4", undefined)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    // 账号桶未被污染：换个 IP 用同一账号名仍然 allowed
    expect(limiter.check("5.6.7.8", "alice")).toEqual({ allowed: true });
    for (let i = 0; i < 5; i++) fail(limiter, "9.9.9.9", "");
    expect(limiter.check("9.9.9.9", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});

describe("LoginRateLimiter decay and pruning", () => {
  it("forgets failures after the window with no new failures", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 3; i++) fail(limiter, "1.2.3.4", "alice");
    advance(600_001);
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
    // 条目已被修剪：再失败从头计数
    for (let i = 0; i < 4; i++) fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
  });

  it("never evicts an active lockout under pressure (P2: eviction is not a lever)", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "locked-ip", "locked-user");
    for (let i = 0; i < 10_001; i++) fail(limiter, `ip-${i}`, undefined);
    limiter.check("irrelevant", undefined);
    expect(limiter.check("locked-ip", undefined)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(limiter.check("locked-ip", "locked-user")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});
