import { describe, expect, it } from "vitest";
import { CHALLENGE_COOKIE } from "./password-login.js";
import {
  aliceChallengeCookie,
  makeHarness,
  post,
  SECRET_ALICE,
} from "../../../test/password-totp-harness.js";

describe("TOTP: challenge submit path", () => {
  it("renders the challenge page when a valid challenge cookie is present (GET)", async () => {
    const h = makeHarness();
    const res = await post(h, "GET", aliceChallengeCookie());
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="code"');
    expect(res.body).toContain('autocomplete="one-time-code"');
    expect(res.body).toContain('inputmode="numeric"');
  });

  it("renders the password page without a challenge cookie (GET, M3 unchanged)", async () => {
    const h = makeHarness();
    const res = await post(h, "GET");
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="username"');
    expect(res.body).not.toContain('name="code"');
  });

  it("correct code: clears challenge cookie and issues session", async () => {
    const h = makeHarness();
    h.setVerifyImpl((secret, code) =>
      secret === SECRET_ALICE && code === "123456" ? 100 : undefined,
    );
    const res = await post(h, "POST", "code=123456&next=/models", aliceChallengeCookie());
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/models");
    const sc = res.headers["set-cookie"];
    expect(sc).toContain(`${CHALLENGE_COOKIE}=;`);
    expect(sc).toContain("Max-Age=0");
    expect(sc).toContain("dsh_auth=");
    expect(h.replayCalls).toEqual([{ username: "alice", counter: 100, code: "123456" }]);
  });

  it("wrong code: 401 and failure counted (replay guard not consulted)", async () => {
    const h = makeHarness();
    h.setVerifyImpl(() => undefined);
    const res = await post(h, "POST", "code=000000", aliceChallengeCookie());
    expect(res.status).toBe(401);
    expect(res.body).toBe("invalid credentials");
    expect(h.replayCalls).toEqual([]);
  });

  it("replayed code (guard false): 401 uniform", async () => {
    const h = makeHarness();
    h.setVerifyImpl((_secret, code) => (code === "123456" ? 100 : undefined));
    h.setReplayImpl(() => false);
    const res = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(res.status).toBe(401);
    expect(h.replayCalls).toEqual([{ username: "alice", counter: 100, code: "123456" }]);
  });

  it("code without challenge cookie: falls back to password path", async () => {
    const h = makeHarness();
    const res = await post(h, "POST", "code=123456");
    // 无挑战 cookie + 无 username/password → 走密码路径 → 空 username → 401
    expect(res.status).toBe(401);
    expect(res.body).toBe("invalid credentials");
  });

  it("expired challenge cookie: treated as absent (password page)", async () => {
    const h = makeHarness();
    const expired = `${CHALLENGE_COOKIE}=alice.${1_700_000_000_000 - 1}`; // 过期
    const res = await post(h, "GET", expired);
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="username"');
  });

  it("unknown user from challenge cookie: 401", async () => {
    const h = makeHarness();
    const unknown = `${CHALLENGE_COOKIE}=mallory.${1_700_000_000_000 + 1000}`;
    const res = await post(h, "POST", "code=123456", unknown);
    expect(res.status).toBe(401);
  });

  it("challenge submit counts toward rate limiting (429 after 5 failures)", async () => {
    const h = makeHarness();
    h.setVerifyImpl(() => undefined);
    for (let i = 0; i < 5; i++) {
      const res = await post(h, "POST", "code=000000", aliceChallengeCookie());
      expect(res.status).toBe(401);
    }
    const locked = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBe("30");
  });
});
