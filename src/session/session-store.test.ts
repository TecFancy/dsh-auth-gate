import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import { describe, expect, it } from "vitest";
import { buildSetCookie, digestToken, SessionStore, type Session } from "./session-store.js";

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

describe("digestToken", () => {
  it("matches the known sha256 vector", () => {
    expect(digestToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("SessionStore", () => {
  it("creates a 43-char base64url token and stores only the digest", async () => {
    const table = new MemTable();
    const store = new SessionStore(table);
    const issued = await store.create("token", 60_000);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(table.get(digestToken(issued.token))?.subject).toBe("token");
    expect(table.keys().next().value).toBe(digestToken(issued.token));
    expect(issued.session.createdAt).toBeGreaterThan(0);
    expect(issued.session.expiresAt - issued.session.createdAt).toBe(60_000);
    expect(issued.session.revoked).toBe(false);
  });

  it("returns the row only for a valid, unexpired, unrevoked token", async () => {
    const table = new MemTable();
    const store = new SessionStore(table);
    const issued = await store.create("token", 60_000);

    expect(store.getByToken(issued.token)?.subject).toBe("token");
    expect(store.getByToken("unknown")).toBeUndefined();

    const digest = digestToken(issued.token);
    await table.put(digest, { ...issued.session, expiresAt: Date.now() - 1000 });
    expect(store.getByToken(issued.token)).toBeUndefined();

    await table.put(digest, { ...issued.session, revoked: true });
    expect(store.getByToken(issued.token)).toBeUndefined();
  });

  it("revokes by deleting the row", async () => {
    const table = new MemTable();
    const store = new SessionStore(table);
    const issued = await store.create("token", 60_000);
    expect(await store.revokeByToken(issued.token)).toBe(true);
    expect(store.getByToken(issued.token)).toBeUndefined();
    expect(await store.revokeByToken(issued.token)).toBe(false);
  });

  it("prunes only expired rows and reports the count", async () => {
    const table = new MemTable();
    const store = new SessionStore(table);
    const fresh = await store.create("fresh", 60_000);
    const stale1 = await store.create("stale1", 60_000);
    const stale2 = await store.create("stale2", 60_000);
    const past = Date.now() - 1000;
    await table.put(digestToken(stale1.token), { ...stale1.session, expiresAt: past });
    await table.put(digestToken(stale2.token), { ...stale2.session, expiresAt: past });

    expect(await store.pruneExpired()).toBe(2);
    expect(store.getByToken(fresh.token)?.subject).toBe("fresh");
    expect(store.getByToken(stale1.token)).toBeUndefined();
    expect(store.getByToken(stale2.token)).toBeUndefined();
  });
});

describe("buildSetCookie", () => {
  it("renders the exact frozen cookie string", () => {
    expect(buildSetCookie("dsh_auth", "tok", 604800)).toBe(
      "dsh_auth=tok; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("omits Secure when secure=false", () => {
    expect(buildSetCookie("dsh_auth", "tok", 604800, false)).toBe(
      "dsh_auth=tok; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
    );
  });

  it("keeps the M1 output when the 4th argument is omitted", () => {
    expect(buildSetCookie("dsh_auth", "tok", 604800)).toBe(
      buildSetCookie("dsh_auth", "tok", 604800, true),
    );
  });
});
