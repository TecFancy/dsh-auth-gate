import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import { describe, expect, it, vi } from "vitest";
import { SessionStore, type Session } from "../../session/index.js";
import type { UsersLoadResult } from "../../shared/index.js";
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
