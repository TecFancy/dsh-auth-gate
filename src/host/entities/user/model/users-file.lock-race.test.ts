import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mutateUsersFile, writeUsersFile, type UserRecord } from "./users-file.js";

/**
 * 锁的「判定 stale → rm」之间的竞态：夺锁必须 compare-then-rm，
 * 只删掉刚刚观测到的那把陈旧锁，绝不删另一个进程刚接手的活锁。
 */

function record(passwordHash: string): UserRecord {
  return { passwordHash, disabled: false, role: "user", mustChangePassword: false };
}

let dir = "";
let file = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-lock-race-"));
  file = path.join(dir, "users.yaml");
  await writeUsersFile(file, { users: new Map([["seed", record("h0")]]) });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

/** 写一把「新鲜」的锁：pid 活着、mtime 是现在，或按 ageMs 倒回。 */
async function writeLock(pid: number, ageMs: number): Promise<void> {
  const owner = { pid, host: os.hostname(), token: "test-token", startedAt: 1 };
  await fs.writeFile(`${file}.lock`, JSON.stringify(owner), { mode: 0o600 });
  const when = new Date(Date.now() - ageMs);
  await fs.utimes(`${file}.lock`, when, when);
}

describe("steal stale lock: compare-then-rm", () => {
  it("does not remove a stale lock that was replaced between check and rm", async () => {
    const lockPath = `${file}.lock`;
    await writeLock(process.pid, 5_000);
    const takeover = JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      token: "takeover",
      startedAt: Date.now(),
    });
    const originalStat = fs.stat.bind(fs);
    let lockStats = 0;
    vi.spyOn(fs, "stat").mockImplementation(async (target, options) => {
      if (target === lockPath) {
        lockStats += 1;
        // 第二次观测（rm 前的复核）之前，外部写者已用新 token 接手同一把锁。
        if (lockStats === 2) await fs.writeFile(lockPath, takeover, { mode: 0o600 });
      }
      return originalStat(target, options);
    });

    // timeout < staleMs：接管后的锁在本次等待窗口内始终「新鲜」，不会被再次判 stale。
    await expect(
      mutateUsersFile(file, () => undefined, { timeoutMs: 40, staleMs: 150 }),
    ).rejects.toThrow("users file is locked by another process");
    expect(lockStats).toBeGreaterThanOrEqual(2);
    // 复核发现不是同一把锁 → 不删；新持有者的锁原样保留。
    expect(await fs.readFile(lockPath, "utf8")).toBe(takeover);
  });
});
