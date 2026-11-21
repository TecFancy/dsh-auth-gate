import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { Session } from "../src/host/entities/session/index.js";
import type { UserRecord, UsersLoadResult } from "../src/host/entities/user/index.js";

export class MemTable implements KvTable<string, Session> {
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

export function snapshot(entries: [string, boolean][]): UsersLoadResult {
  return {
    missing: false,
    snapshot: {
      users: new Map(entries.map(([name, disabled]) => [name, { passwordHash: "hash", disabled }])),
    },
  };
}

/** 按字段覆盖构造快照（L5 的 passwordChangedAt、L12 的删号用例）。 */
export function usersOf(entries: [string, Partial<UserRecord>][]): UsersLoadResult {
  return {
    missing: false,
    snapshot: {
      users: new Map(
        entries.map(([name, extra]) => [name, { passwordHash: "hash", disabled: false, ...extra }]),
      ),
    },
  };
}

export const silentLog = { info: (): void => undefined, warn: (): void => undefined };
