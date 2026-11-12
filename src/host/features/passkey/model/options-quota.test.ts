import { describe, expect, it } from "vitest";
import { PasskeyOptionsQuota } from "./options-quota.js";

/** 可推进的假时钟。 */
function makeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe("PasskeyOptionsQuota", () => {
  it("allows up to the per-IP limit and then rejects with a retry hint", () => {
    const clock = makeClock();
    const quota = new PasskeyOptionsQuota({ perIpLimit: 3, globalLimit: 100, now: clock.now });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(quota.check("1.1.1.1")).toEqual({ allowed: true });
      quota.consume("1.1.1.1");
    }
    const blocked = quota.check("1.1.1.1");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("does not count a rejected check (429 must not consume quota)", () => {
    const clock = makeClock();
    const quota = new PasskeyOptionsQuota({ perIpLimit: 1, globalLimit: 100, now: clock.now });
    quota.consume("1.1.1.1");
    expect(quota.check("1.1.1.1").allowed).toBe(false);
    expect(quota.check("1.1.1.1").allowed).toBe(false);
    clock.advance(60_000);
    expect(quota.check("1.1.1.1")).toEqual({ allowed: true });
  });

  it("keeps per-IP buckets independent", () => {
    const clock = makeClock();
    const quota = new PasskeyOptionsQuota({ perIpLimit: 1, globalLimit: 100, now: clock.now });
    quota.consume("1.1.1.1");
    expect(quota.check("1.1.1.1").allowed).toBe(false);
    expect(quota.check("2.2.2.2")).toEqual({ allowed: true });
  });

  it("enforces the global bucket across many IPs", () => {
    const clock = makeClock();
    const quota = new PasskeyOptionsQuota({ perIpLimit: 100, globalLimit: 2, now: clock.now });
    quota.consume("1.1.1.1");
    quota.consume("2.2.2.2");
    const blocked = quota.check("3.3.3.3");
    expect(blocked.allowed).toBe(false);
  });

  it("slides the window so old hits stop counting", () => {
    const clock = makeClock();
    const quota = new PasskeyOptionsQuota({ perIpLimit: 2, globalLimit: 100, now: clock.now });
    quota.consume("1.1.1.1");
    clock.advance(30_000);
    quota.consume("1.1.1.1");
    expect(quota.check("1.1.1.1").allowed).toBe(false);
    clock.advance(30_001);
    expect(quota.check("1.1.1.1")).toEqual({ allowed: true });
  });

  it("uses the documented defaults (20 per IP, 120 global, 60s window)", () => {
    const clock = makeClock();
    const quota = new PasskeyOptionsQuota({ now: clock.now });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(quota.check("1.1.1.1").allowed).toBe(true);
      quota.consume("1.1.1.1");
    }
    expect(quota.check("1.1.1.1").allowed).toBe(false);
  });
});
