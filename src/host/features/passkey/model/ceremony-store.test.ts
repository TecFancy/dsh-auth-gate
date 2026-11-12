import { describe, expect, it } from "vitest";
import { CeremonyStore } from "./ceremony-store.js";

const NOW = 1_700_000_000_000;
const BASE64URL_ID = /^[A-Za-z0-9_-]{43}$/;

describe("CeremonyStore: create", () => {
  it("issues an opaque 32-byte base64url id and challenge with the default 120s TTL", () => {
    const store = new CeremonyStore({ now: () => NOW });
    const record = store.create({ kind: "login" });

    expect(record.id).toMatch(BASE64URL_ID);
    expect(record.challenge).toBeInstanceOf(Uint8Array);
    expect(record.challenge).toHaveLength(32);
    expect(record.kind).toBe("login");
    expect(record.expiresAt).toBe(NOW + 120_000);
    expect(record.userId).toBeUndefined();
    expect(record.userHandle).toBeUndefined();
    expect(record.label).toBeUndefined();
  });

  it("carries optional binding fields through", () => {
    const store = new CeremonyStore({ now: () => NOW });
    const record = store.create({
      kind: "register",
      userId: "alice",
      userHandle: "handle-1",
      label: "MacBook Touch ID",
    });

    expect(record.kind).toBe("register");
    expect(record.userId).toBe("alice");
    expect(record.userHandle).toBe("handle-1");
    expect(record.label).toBe("MacBook Touch ID");
  });

  it("issues a distinct id per ceremony", () => {
    const store = new CeremonyStore({ now: () => NOW });
    const ids = new Set(Array.from({ length: 50 }, () => store.create({ kind: "login" }).id));
    expect(ids.size).toBe(50);
  });

  it("defaults to a 1024-entry cap", () => {
    const store = new CeremonyStore({ now: () => NOW });
    const first = store.create({ kind: "login" });
    for (let index = 0; index < 1024; index++) store.create({ kind: "login" });

    expect(store.consume(first.id)).toBeUndefined();
  });

  it("uses the injected random source for id and challenge in order", () => {
    const idBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const challengeBytes = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const queue: Uint8Array[] = [idBytes, challengeBytes];
    const store = new CeremonyStore({
      now: () => NOW,
      random: () => queue.shift() ?? new Uint8Array(32),
    });

    const record = store.create({ kind: "login" });

    expect(record.id).toBe(Buffer.from(idBytes).toString("base64url"));
    expect(record.challenge).toEqual(challengeBytes);
  });
});

describe("CeremonyStore: consume", () => {
  it("deletes first, so a replay of the same id sees undefined", () => {
    const store = new CeremonyStore({ now: () => NOW });
    const record = store.create({ kind: "login" });

    expect(store.consume(record.id)).toBe(record);
    expect(store.consume(record.id)).toBeUndefined();
  });

  it("rejects empty and unknown ids", () => {
    const store = new CeremonyStore({ now: () => NOW });
    store.create({ kind: "login" });

    expect(store.consume("")).toBeUndefined();
    expect(store.consume("not-a-ceremony")).toBeUndefined();
  });

  it("treats expiresAt <= now as expired and honors the injected TTL", () => {
    let now = NOW;
    const store = new CeremonyStore({ now: () => now, ttlMs: 5_000 });
    const live = store.create({ kind: "login" });

    now = NOW + 4_999;
    expect(store.consume(live.id)).toBe(live);

    const expiring = store.create({ kind: "login" });
    now = NOW + 9_999; // expiring.expiresAt = NOW + 9_999
    expect(store.consume(expiring.id)).toBeUndefined();
  });

  it("prunes expired entries on create", () => {
    let now = NOW;
    const store = new CeremonyStore({ now: () => now, ttlMs: 1_000, maxEntries: 1 });
    const stale = store.create({ kind: "login" });

    now = NOW + 1_000;
    const fresh = store.create({ kind: "login" });

    expect(store.consume(fresh.id)).toBe(fresh);
    expect(store.consume(stale.id)).toBeUndefined();
  });

  it("evicts the oldest entries beyond maxEntries", () => {
    const store = new CeremonyStore({ now: () => NOW, maxEntries: 3 });
    const ids = Array.from(
      { length: 4 },
      (_, index) => store.create({ kind: "login", label: `r${index}` }).id,
    );

    expect(store.consume(ids[0]!)).toBeUndefined();
    expect(store.consume(ids[1]!)?.label).toBe("r1");
    expect(store.consume(ids[2]!)?.label).toBe("r2");
    expect(store.consume(ids[3]!)?.label).toBe("r3");
  });
});
