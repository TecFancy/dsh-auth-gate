import { describe, expect, it, vi } from "vitest";
import { SessionStore } from "../../../entities/session/index.js";
import { DisabledSessionSweeper } from "./disabled-sweeper.js";
import {
  MemTable,
  silentLog,
  snapshot,
  usersOf,
} from "../../../../../test/disabled-sweeper-harness.js";
import type { UsersLoadResult } from "../../../entities/user/index.js";

describe("DisabledSessionSweeper.sweep", () => {
  it("revokes sessions of disabled users and keeps active users signed in", async () => {
    const store = new SessionStore(new MemTable());
    const alice = await store.create("alice", 60_000);
    const second = await store.create("alice", 60_000);
    const bob = await store.create("bob", 60_000);
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () =>
        Promise.resolve(
          snapshot([
            ["alice", true],
            ["bob", false],
          ]),
        ),
      log: silentLog,
    });

    expect(await sweeper.sweep()).toBe(2);
    expect(store.getByToken(alice.token)).toBeUndefined();
    expect(store.getByToken(second.token)).toBeUndefined();
    expect(store.getByToken(bob.token)?.subject).toBe("bob");
    expect(await sweeper.sweep()).toBe(0);
  });

  it("does nothing when the users file is missing or the session layer is unavailable", async () => {
    const store = new SessionStore(new MemTable());
    const issued = await store.create("alice", 60_000);
    const missing = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () => Promise.resolve({ missing: true, snapshot: { users: new Map() } }),
      log: silentLog,
    });
    expect(await missing.sweep()).toBe(0);
    expect(store.getByToken(issued.token)?.subject).toBe("alice");

    const noSessions = new DisabledSessionSweeper({
      sessions: () => undefined,
      loadUsers: () => Promise.resolve(snapshot([["alice", true]])),
      log: silentLog,
    });
    expect(await noSessions.sweep()).toBe(0);
  });

  it("warns once and keeps sessions when the users file cannot be read", async () => {
    const store = new SessionStore(new MemTable());
    const issued = await store.create("alice", 60_000);
    const warn = vi.fn();
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () => Promise.reject(new Error("insecure permissions")),
      log: { info: (): void => undefined, warn },
    });

    expect(await sweeper.sweep()).toBe(0);
    expect(await sweeper.sweep()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(store.getByToken(issued.token)?.subject).toBe("alice");
  });

  it("does not reject when the session domain is already closed (disposal race)", async () => {
    const warn = vi.fn();
    let calls = 0;
    // 插件卸载时 domain 已 close，而定时器可能还有一个 tick 在途（Windows CI 实测）。
    const closedStore = {
      revokeBySubject: (): Promise<number> => {
        calls += 1;
        return Promise.reject(new Error("domain 'dsh_auth_sessions' is closed"));
      },
    } as unknown as SessionStore;
    const sweeper = new DisabledSessionSweeper({
      sessions: () => closedStore,
      loadUsers: () => Promise.resolve(snapshot([["alice", true]])),
      log: { info: (): void => undefined, warn },
    });

    expect(await sweeper.sweep()).toBe(0);
    expect(await sweeper.sweep()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });
});

describe("DisabledSessionSweeper.sweep: password_changed_at (L5)", () => {
  it("revokes sessions issued under the old credential version and keeps newer ones", async () => {
    const table = new MemTable();
    let now = 1_000_000;
    const store = new SessionStore(table, { now: () => now });
    const stamp = new Date(1_500_000).toISOString();
    const before = await store.create("alice", 60_000_000); // 旧口令签发，无版本
    now = 2_000_000;
    const after = await store.create("alice", 60_000_000, "full", stamp); // 新口令签发
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () => Promise.resolve(usersOf([["alice", { passwordChangedAt: stamp }]])),
      log: silentLog,
    });

    expect(await sweeper.sweep()).toBe(1);
    expect(store.getByToken(before.token)).toBeUndefined();
    expect(store.getByToken(after.token)?.subject).toBe("alice");
    // 重复扫描幂等：版本一致的会话不会被反复误杀。
    expect(await sweeper.sweep()).toBe(0);
    expect(store.getByToken(after.token)?.subject).toBe("alice");
  });

  it("revokes a session even when it was issued after the stamp (verification race)", async () => {
    const table = new MemTable();
    const now = 2_000_000;
    const store = new SessionStore(table, { now: () => now });
    const stamp = new Date(1_500_000).toISOString();
    // 哈希校验跨越了改密：签发时刻晚于时间戳，但手里读到的还是旧记录。
    const raced = await store.create("alice", 60_000_000, "full", undefined);
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () => Promise.resolve(usersOf([["alice", { passwordChangedAt: stamp }]])),
      log: silentLog,
    });
    expect(await sweeper.sweep()).toBe(1);
    expect(store.getByToken(raced.token)).toBeUndefined();
  });

  it("ignores a far-future stamp instead of repeatedly revoking new sessions", async () => {
    const table = new MemTable();
    const now = 1_000_000;
    const store = new SessionStore(table, { now: () => now });
    const session = await store.create("alice", 60_000_000);
    const warn = vi.fn();
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      now: () => now,
      loadUsers: () =>
        Promise.resolve(
          usersOf([["alice", { passwordChangedAt: new Date(9_000_000).toISOString() }]]),
        ),
      log: { ...silentLog, warn },
    });

    // 远超 now + 5min：忽略，绝不每轮吊销新会话（否则等于永久锁死该用户）
    expect(await sweeper.sweep()).toBe(0);
    expect(store.getByToken(session.token)?.subject).toBe("alice");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("in the future"));
  });

  it("ignores an unparseable timestamp instead of revoking on it", async () => {
    const store = new SessionStore(new MemTable());
    const issued = await store.create("alice", 60_000);
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () => Promise.resolve(usersOf([["alice", { passwordChangedAt: "not-a-date" }]])),
      log: silentLog,
    });
    expect(await sweeper.sweep()).toBe(0);
    expect(store.getByToken(issued.token)?.subject).toBe("alice");
  });
});

describe("DisabledSessionSweeper.sweep: deleted users (L12)", () => {
  it("revokes sessions of subjects no longer in users.yaml, exempting internal subjects", async () => {
    const store = new SessionStore(new MemTable());
    const alice = await store.create("alice", 60_000);
    const ghost = await store.create("ghost", 60_000);
    const bootstrap = await store.create("@bootstrap", 60_000, "bootstrap");
    const token = await store.create("token", 60_000);
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () => Promise.resolve(usersOf([["alice", {}]])),
      log: silentLog,
    });

    expect(await sweeper.sweep()).toBe(1);
    expect(store.getByToken(alice.token)?.subject).toBe("alice");
    expect(store.getByToken(ghost.token)).toBeUndefined();
    expect(store.getByToken(bootstrap.token)?.subject).toBe("@bootstrap");
    expect(store.getByToken(token.token)?.subject).toBe("token");
  });
});

describe("DisabledSessionSweeper logging rate limit (L12)", () => {
  it("re-warns at most once per interval instead of once per process", async () => {
    let now = 1_000_000;
    const warn = vi.fn();
    const sweeper = new DisabledSessionSweeper({
      sessions: () => new SessionStore(new MemTable()),
      loadUsers: () => Promise.reject(new Error("insecure permissions")),
      now: () => now,
      log: { info: (): void => undefined, warn },
    });

    expect(await sweeper.sweep()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    now += 30_000;
    expect(await sweeper.sweep()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1); // 限速窗口内保持安静
    now += 31_000;
    expect(await sweeper.sweep()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2); // 超过 60s 再报一次
  });
});

describe("DisabledSessionSweeper.start", () => {
  it("start() is a no-op when the interval is disabled and sweeps when enabled", async () => {
    const store = new SessionStore(new MemTable());
    const issued = await store.create("alice", 60_000);
    const loadUsers = (): Promise<UsersLoadResult> => Promise.resolve(snapshot([["alice", true]]));

    const off = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers,
      intervalMs: 0,
      log: silentLog,
    });
    const offDispose = off.start();
    expect(offDispose).toBeTypeOf("function");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.getByToken(issued.token)?.subject).toBe("alice");
    offDispose();

    const on = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers,
      intervalMs: 10,
      log: silentLog,
    });
    const dispose = on.start();
    try {
      await vi.waitFor(() => {
        expect(store.getByToken(issued.token)).toBeUndefined();
      });
    } finally {
      dispose();
    }
  });
});
