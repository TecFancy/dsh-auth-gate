import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LoginRateLimiter,
  loadUsersFile,
  mutateUsersFile,
  writeUsersFile,
} from "../../shared/index.js";
import type { UserRecord, UsersSnapshot } from "../../shared/index.js";
import type { PasswordChangeDeps } from "./password-change.js";
import {
  CURRENT,
  GOOD_BODY,
  NEW_HASH,
  NEW_PASSWORD,
  activeUser,
  formBody,
  jsonBody,
  makeHarness,
  send,
} from "../../../test/password-change-harness.js";

describe("processing order (frozen, §1)", () => {
  it("write failure never revokes sessions (no kick-out without a real password change)", async () => {
    const { deps, store, users, state } = makeHarness({
      mutateUsers: () => Promise.reject(new Error("cannot remove the last admin")),
    });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(503);
    expect(state.revokes).toBe(0);
    expect(store.has("good")).toBe(true); // 会话仍在
    expect(users.get("alice")?.passwordHash).toBe(activeUser().passwordHash); // 旧口令仍有效
  });

  it("revokes only after the hash was written", async () => {
    const order: string[] = [];
    const { deps } = makeHarness({
      mutateUsers: async (mutator) => {
        order.push("write");
        await mutator({ users: new Map([["alice", activeUser()]]) });
      },
      revoke: () => {
        order.push("revoke");
        return Promise.resolve();
      },
    });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(200);
    expect(order).toEqual(["write", "revoke"]);
  });

  it("reads the users file before verifying the current password", async () => {
    const order: string[] = [];
    const { deps } = makeHarness({
      loadUsers: () => {
        order.push("load");
        return Promise.resolve({
          snapshot: { users: new Map([["alice", activeUser()]]) },
          missing: false,
        });
      },
      verify: () => {
        order.push("verify");
        return Promise.resolve(true);
      },
    });
    await send(deps, { body: GOOD_BODY });
    // 判定读 → verify(旧口令) → verify(sameAsOld 复核)
    expect(order.slice(0, 3)).toEqual(["load", "verify", "verify"]);
  });
});

describe("rate limit and store invariants", () => {
  it("rejects a locked bucket before looking at credentials", async () => {
    const verify = vi.fn(() => Promise.resolve(true));
    const limiter = new LoginRateLimiter();
    const { deps } = makeHarness({ limiter, verify });
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure("127.0.0.1", "alice");
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(429);
    expect(verify).not.toHaveBeenCalled();
  });

  it("keeps the accumulated failure count when the store write fails", async () => {
    const limiter = new LoginRateLimiter();
    const { deps } = makeHarness({
      limiter,
      mutateUsers: () => Promise.reject(new Error("users file is locked")),
    });
    for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure("127.0.0.1", "alice");
    await send(deps, { body: GOOD_BODY }); // 写盘失败计第 5 次失败
    expect(limiter.check("127.0.0.1", "alice").allowed).toBe(false);
  });

  it("clears the bucket on success (the user is not locked out by their own change)", async () => {
    const limiter = new LoginRateLimiter();
    const { deps } = makeHarness({ limiter });
    for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure("127.0.0.1", "alice");
    await send(deps, { body: GOOD_BODY }); // recordSuccess 清桶
    limiter.recordFailure("127.0.0.1", "alice"); // 若未清桶这里就是第 5 次 → 锁定
    expect(limiter.check("127.0.0.1", "alice").allowed).toBe(true);
  });

  it("does not touch the store on a policy rejection", async () => {
    const { deps, state } = makeHarness();
    const res = await send(deps, {
      body: formBody({ current: CURRENT, password: NEW_PASSWORD.slice(0, 5) }),
    });
    expect(res.status).toBe(400);
    expect(jsonBody(res)).toEqual({
      error: "policy",
      rules: ["minLength", "digit", "special"],
    });
    expect(state.writes).toBe(0);
    expect(state.revokes).toBe(0);
  });
});

describe("locked snapshot semantics (A7 §4.2)", () => {
  it("writes through the locked snapshot, not the pre-read one", async () => {
    const preRead = new Map<string, UserRecord>([["alice", activeUser()]]);
    const locked = new Map<string, UserRecord>([
      ["alice", activeUser({ mustChangePassword: true })],
    ]);
    const preWrite = activeUser().passwordHash;
    const seen: UsersSnapshot[] = [];
    const { deps } = makeHarness({
      loadUsers: () => Promise.resolve({ snapshot: { users: preRead }, missing: false }),
      mutateUsers: async (mutator) => {
        const snapshot: UsersSnapshot = { users: locked };
        seen.push(snapshot);
        await mutator(snapshot);
      },
    });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(locked.get("alice")?.passwordHash).toBe(NEW_HASH);
    expect(locked.get("alice")?.mustChangePassword).toBeFalsy(); // B1：成功后清标记
    expect(preRead.get("alice")?.passwordHash).toBe(preWrite); // 判定读的快照未被写入
  });
});

describe("must_change_password clearing (B1 §10)", () => {
  it("clears the flag on disk after a self-service change", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-pwchange-flag-"));
    const usersPath = join(root, "users.yaml");
    try {
      await writeUsersFile(usersPath, {
        users: new Map([
          ["alice", { passwordHash: "old-hash", disabled: false, mustChangePassword: true }],
        ]),
      });
      const res = await send(makeHarness(realFileDeps(usersPath)).deps, { body: GOOD_BODY });
      expect(res.status).toBe(200);
      const text = readFileSync(usersPath, "utf8");
      expect(text).not.toContain("must_change_password");
      expect(text).toContain(NEW_HASH);
      expect(text).toBe(await controlBytes(root)); // 默认值不落盘：与「无该字段」对照逐字节一致
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not add the field when it was absent (write-back stays byte-identical)", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-pwchange-noflag-"));
    const usersPath = join(root, "users.yaml");
    try {
      await writeUsersFile(usersPath, {
        users: new Map([["alice", { passwordHash: "old-hash", disabled: false }]]),
      });
      const res = await send(makeHarness(realFileDeps(usersPath)).deps, { body: GOOD_BODY });
      expect(res.status).toBe(200);
      expect(readFileSync(usersPath, "utf8")).toBe(await controlBytes(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** 真文件 + 真锁（mutateUsersFile/loadUsersFile）；verify/hash 用假实现：只测写盘语义。 */
function realFileDeps(usersPath: string): Partial<PasswordChangeDeps> {
  return {
    loadUsers: () => loadUsersFile(usersPath),
    mutateUsers: (mutator) => mutateUsersFile(usersPath, mutator),
    // 只有「现口令 + 旧 hash」这一组为真：sameAsOld 复核（新口令 vs 旧 hash）必须为假。
    verify: (password, storedHash) =>
      Promise.resolve(password === CURRENT && storedHash === "old-hash"),
  };
}

/** 对照文件：由 writeUsersFile 直接序列化「改密后应有的快照」（role/false 不落盘）。 */
async function controlBytes(root: string): Promise<string> {
  const control = join(root, "control.yaml");
  await writeUsersFile(control, {
    users: new Map([["alice", { passwordHash: NEW_HASH, disabled: false }]]),
  });
  return readFileSync(control, "utf8");
}
