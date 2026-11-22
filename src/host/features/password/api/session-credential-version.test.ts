import { describe, expect, it } from "vitest";
import { makeHarness, post, sessionToken } from "../../../../../test/password-totp-harness.js";

describe("login sessions record the credential version (L5/P1)", () => {
  it("stores the password_changed_at seen at authentication time", async () => {
    const h = makeHarness();
    const stamp = "2026-11-22T00:00:00.000Z";
    h.users.set("alice", { passwordHash: "h-alice", disabled: false, passwordChangedAt: stamp });

    const res = await post(h, "POST", "username=alice&password=pw");
    expect(res.status).toBe(302);
    const token = sessionToken(res.headers);
    expect(h.storeOf()?.getByToken(token)?.credentialVersion).toBe(stamp);
  });

  it("leaves the version absent when the user never changed a password", async () => {
    const h = makeHarness();
    h.users.set("bob", { passwordHash: "h-bob", disabled: false });

    const res = await post(h, "POST", "username=bob&password=pw");
    expect(res.status).toBe(302);
    const token = sessionToken(res.headers);
    expect(h.storeOf()?.getByToken(token)?.credentialVersion).toBeUndefined();
  });
});
