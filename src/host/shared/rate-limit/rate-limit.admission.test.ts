import { describe, expect, it } from "vitest";
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
