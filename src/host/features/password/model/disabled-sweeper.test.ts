import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import { describe, expect, it, vi } from "vitest";
import { SessionStore, type Session } from "../../../entities/session/index.js";
import type { UserRecord, UsersLoadResult } from "../../../entities/user/index.js";
import { DisabledSessionSweeper } from "./disabled-sweeper.js";

class MemTable implements KvTable<string, Session> {
  private readonly map = new Map<string, Session>();

  get size(): number {
    return this.map.size;
  }

  get(key: string): Session | undefined {
    return this.map.get(key);
  }

  entries(): IterableIterator<[string, Session]> {
    return this.map.entries();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  put(key: string, value: Session): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.map.delete(key));
  }

  deleteMany(keys: readonly string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.map.delete(key)) removed += 1;
    return Promise.resolve(removed);
  }

  update(key: string, fn: (current: Session) => Session): Promise<Session> {
    const current = this.map.get(key);
    if (current === undefined) throw new Error("missing-key");
    const next = fn(current);
    this.map.set(key, next);
    return Promise.resolve(next);
  }
}

function snapshot(entries: [string, boolean][]): UsersLoadResult {
  return {
    missing: false,
    snapshot: {
      users: new Map(entries.map(([name, disabled]) => [name, { passwordHash: "hash", disabled }])),
    },
  };
}

/** 按字段覆盖构造快照（L5 的 passwordChangedAt、L12 的删号用例）。 */
function usersOf(entries: [string, Partial<UserRecord>][]): UsersLoadResult {
  return {
    missing: false,
    snapshot: {
      users: new Map(
        entries.map(([name, extra]) => [name, { passwordHash: "hash", disabled: false, ...extra }]),
      ),
    },
  };
}

const silentLog = { info: (): void => undefined, warn: (): void => undefined };

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
  it("revokes sessions created before the change and keeps later ones", async () => {
    const table = new MemTable();
    let now = 1_000_000;
    const store = new SessionStore(table, { now: () => now });
    const before = await store.create("alice", 60_000_000); // createdAt 1_000_000
    now = 2_000_000;
    const after = await store.create("alice", 60_000_000); // createdAt 2_000_000
    const sweeper = new DisabledSessionSweeper({
      sessions: () => store,
      loadUsers: () =>
        Promise.resolve(
          usersOf([["alice", { passwordChangedAt: new Date(1_500_000).toISOString() }]]),
        ),
      log: silentLog,
    });

    expect(await sweeper.sweep()).toBe(1);
    expect(store.getByToken(before.token)).toBeUndefined();
    expect(store.getByToken(after.token)?.subject).toBe("alice");
    // 绝对时间规则：重复扫描幂等，不会误杀改密后登录的新会话。
    expect(await sweeper.sweep()).toBe(0);
    expect(store.getByToken(after.token)?.subject).toBe("alice");
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
