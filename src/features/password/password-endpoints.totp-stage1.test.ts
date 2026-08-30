import { describe, expect, it } from "vitest";
import { CHALLENGE_TTL_SECONDS, CHALLENGE_COOKIE } from "./password-login.js";
import { makeHarness, post } from "../../../test/password-totp-harness.js";

describe("TOTP: password stage issues challenge cookie", () => {
  it("optional + secret user: 302 to /auth/login with challenge cookie, no session cookie", async () => {
    const h = makeHarness();
    const res = await post(h, "POST", "username=alice&password=pw&next=/models");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/login?next=%2Fmodels");
    const sc = res.headers["set-cookie"];
    expect(sc).toContain(`${CHALLENGE_COOKIE}=alice.`);
    expect(sc).toContain(`Max-Age=${CHALLENGE_TTL_SECONDS}`);
    expect(sc).not.toContain("dsh_auth="); // 未发会话
  });

  it("optional + no-secret user: straight session (M3 behavior)", async () => {
    const h = makeHarness();
    const res = await post(h, "POST", "username=bob&password=pw");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
    expect(res.headers["set-cookie"]).not.toContain(CHALLENGE_COOKIE);
  });

  it("off mode ignores secrets entirely (straight session)", async () => {
    const h = makeHarness();
    h.setTotpMode("off");
    const res = await post(h, "POST", "username=alice&password=pw");
    expect(res.status).toBe(302);
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
  });

  it("required + no-secret user: 401 (uniform, counted as failure)", async () => {
    const h = makeHarness();
    h.setTotpMode("required");
    const res = await post(h, "POST", "username=bob&password=pw");
    expect(res.status).toBe(401);
    expect(res.body).toBe("invalid credentials");
  });

  it("disabled user with secret is blocked at the password stage", async () => {
    const h = makeHarness();
    const alice = h.users.get("alice")!;
    h.users.set("alice", { ...alice, disabled: true });
    const res = await post(h, "POST", "username=alice&password=pw");
    expect(res.status).toBe(401);
  });
});
