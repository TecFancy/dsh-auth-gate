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

function fail(limiter: LoginRateLimiter, ip: string, account?: string): void {
  limiter.recordFailure(ip, account);
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

  it("resets counters after the lockout expires", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) fail(limiter, "1.2.3.4", "alice");
    advance(30_000);
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
    // 重置后重新从 1 计数：再 4 次失败仍 allowed
    for (let i = 0; i < 4; i++) fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
    fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("clears both buckets on success", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 4; i++) fail(limiter, "1.2.3.4", "alice");
    limiter.recordSuccess("1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
    // 成功清零后从头计数
    for (let i = 0; i < 4; i++) fail(limiter, "1.2.3.4", "alice");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
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

  it("caps the bucket at 10000 entries, evicting the oldest", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 10_001; i++) fail(limiter, `ip-${i}`, undefined);
    // 灌满后任意一次 check 触发修剪
    expect(limiter.check("irrelevant", undefined)).toEqual({ allowed: true });
    expect(limiter.check("ip-0", undefined)).toEqual({ allowed: true }); // 最早插入的被淘汰
    expect(limiter.check("ip-10000", undefined)).toEqual({ allowed: true });
  });
});
