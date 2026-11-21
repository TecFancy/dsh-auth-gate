import { describe, expect, it } from "vitest";
import { combineAdmissions } from "./types.js";
import { LoginRateLimiter } from "./rate-limit.js";

function makeLimiter(options: ConstructorParameters<typeof LoginRateLimiter>[0] = {}): {
  limiter: LoginRateLimiter;
  advance: (ms: number) => void;
} {
  let now = 1_000_000;
  const limiter = new LoginRateLimiter({ ...options, now: () => now });
  return {
    limiter,
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("LoginRateLimiter admission (atomic check + reservation)", () => {
  it("admits a burst only up to maxFailures for one account (P1.3)", () => {
    const { limiter } = makeLimiter();
    const admissions = [];
    for (let i = 0; i < 6; i++) {
      const result = limiter.admit("1.2.3.4", "alice");
      expect(result.admitted).toBe(i < 5);
      if (result.admitted) admissions.push(result.admission);
      else expect(result.retryAfterSeconds).toBe(1);
    }
    for (const admission of admissions) admission.settle("failure");
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("releases the reservation on abandon without counting a failure", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) {
      const result = limiter.admit("1.2.3.4", "alice");
      expect(result.admitted).toBe(true);
      if (result.admitted) result.admission.settle("abandon");
    }
    expect(limiter.check("1.2.3.4", "alice")).toEqual({ allowed: true });
  });

  it("settle is idempotent", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) {
      const result = limiter.admit("1.2.3.4", "alice");
      if (!result.admitted) throw new Error("expected admission");
      result.admission.settle("failure");
      result.admission.settle("failure");
    }
    const late = limiter.admit("1.2.3.4", "alice");
    expect(late.admitted).toBe(false);
    expect(limiter.check("1.2.3.4", "alice")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("lets the first attempt through after a lock expires and keeps escalating (P1 regression)", () => {
    const { limiter, advance } = makeLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = limiter.admit("1.2.3.4", "alice");
      if (!result.admitted) throw new Error("expected admission");
      result.admission.settle("failure");
    }
    expect(limiter.admit("1.2.3.4", "alice")).toEqual({ admitted: false, retryAfterSeconds: 30 });
    advance(30_001);
    const probe = limiter.admit("1.2.3.4", "alice");
    expect(probe.admitted).toBe(true);
    if (!probe.admitted) return;
    probe.admission.settle("failure");
    // 第 6 次打击：30s × 2 = 60s（旧实现会永久 429，退避永不升级）
    expect(limiter.admit("1.2.3.4", "alice")).toEqual({ admitted: false, retryAfterSeconds: 60 });
  });
});

describe("LoginRateLimiter admission accounting", () => {
  it("a failure settled through a combined admission counts once (P1: no double strike)", () => {
    const { limiter } = makeLimiter();
    // 模拟 passkey：先占 IP，再占账号，合并后结算一次失败。
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const ip = limiter.admit("1.2.3.4", undefined, "passkey");
      const acct = limiter.admitAccount("alice", "passkey");
      if (!ip.admitted || !acct.admitted) throw new Error("expected admission");
      combineAdmissions(ip.admission, acct.admission).settle("failure");
    }
    // 4 次失败后仍未锁（若一次失败记两笔，第 3 次就锁了）
    expect(limiter.check("1.2.3.4", "alice", "passkey")).toEqual({ allowed: true });
    const ip = limiter.admit("1.2.3.4", undefined, "passkey");
    const acct = limiter.admitAccount("alice", "passkey");
    if (!ip.admitted || !acct.admitted) throw new Error("expected admission");
    combineAdmissions(ip.admission, acct.admission).settle("failure");
    expect(limiter.check("1.2.3.4", "alice", "passkey")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("account admission settle is idempotent", () => {
    const { limiter } = makeLimiter();
    const acct = limiter.admitAccount("alice", "passkey");
    if (!acct.admitted) throw new Error("expected admission");
    acct.admission.settle("failure");
    acct.admission.settle("failure");
    // 只记一次：再失败 4 次才到 5
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = limiter.admitAccount("alice", "passkey");
      if (!next.admitted) throw new Error("expected admission");
      next.admission.settle("failure");
    }
    expect(limiter.check("0.0.0.0", "alice", "passkey")).toEqual({ allowed: true });
  });

  it("caps concurrent in-flight attempts per IP without locking it", () => {
    let now = 1_000_000;
    const limiter = new LoginRateLimiter({ now: () => now, maxConcurrentPerIp: 2 });
    const first = limiter.admit("1.2.3.4", undefined);
    const second = limiter.admit("1.2.3.4", undefined);
    expect(first.admitted).toBe(true);
    expect(second.admitted).toBe(true);
    expect(limiter.admit("1.2.3.4", undefined)).toEqual({
      admitted: false,
      retryAfterSeconds: 1,
    });
    if (first.admitted) first.admission.settle("success");
    now += 1;
    expect(limiter.admit("1.2.3.4", undefined).admitted).toBe(true);
  });
});
