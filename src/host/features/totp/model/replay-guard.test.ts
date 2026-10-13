import { describe, expect, it } from "vitest";
import { TotpReplayGuard } from "./replay-guard.js";

describe("TotpReplayGuard", () => {
  it("records a first use and rejects the same (counter, code) again", () => {
    const guard = new TotpReplayGuard();
    expect(guard.checkAndRecord("alice", 100, "123456")).toBe(true);
    expect(guard.checkAndRecord("alice", 100, "123456")).toBe(false);
  });

  it("allows the same code at a different counter", () => {
    const guard = new TotpReplayGuard();
    expect(guard.checkAndRecord("alice", 100, "123456")).toBe(true);
    expect(guard.checkAndRecord("alice", 101, "123456")).toBe(true);
  });

  it("rejects a different code at the same counter", () => {
    const guard = new TotpReplayGuard();
    expect(guard.checkAndRecord("alice", 100, "123456")).toBe(true);
    expect(guard.checkAndRecord("alice", 100, "654321")).toBe(false);
  });

  it("isolates users", () => {
    const guard = new TotpReplayGuard();
    expect(guard.checkAndRecord("alice", 100, "123456")).toBe(true);
    expect(guard.checkAndRecord("bob", 100, "123456")).toBe(true);
  });

  it("prunes stale counters on insert (older than counter-1)", () => {
    const guard = new TotpReplayGuard();
    expect(guard.checkAndRecord("alice", 100, "123456")).toBe(true);
    // counter 跳到 200：100 < 199，应被清理；200 的 code 可再用 100 的 code 吗？
    // 不直接断言内部状态，但清理后同一 (100, code) 不再被查重（允许再次登记）。
    expect(guard.checkAndRecord("alice", 200, "654321")).toBe(true);
    // 若 100 已被清理，重新登记 (100, "123456") 返回 true（不再认为是重放）
    expect(guard.checkAndRecord("alice", 100, "123456")).toBe(true);
  });

  it("caps entries per user, evicting oldest counters", () => {
    const guard = new TotpReplayGuard();
    for (let counter = 0; counter < 20; counter++) {
      expect(guard.checkAndRecord("alice", counter, `code${counter}`)).toBe(true);
    }
    // 20 次插入，cap 9：最老的 counter 应已被逐出
    expect(guard.checkAndRecord("alice", 0, "code0")).toBe(true);
  });

  it("caps total users, evicting the oldest user", () => {
    const guard = new TotpReplayGuard();
    for (let i = 0; i < 10_001; i++) {
      expect(guard.checkAndRecord(`user${i}`, 1, "123456")).toBe(true);
    }
    // user0 应已被逐出（最早插入）；user10000 仍保留
    expect(guard.checkAndRecord("user0", 1, "123456")).toBe(true);
    expect(guard.checkAndRecord("user10000", 1, "123456")).toBe(false);
  });
});
