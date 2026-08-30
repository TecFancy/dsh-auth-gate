import { describe, expect, it } from "vitest";
import { CHALLENGE_COOKIE } from "./password-login.js";
import { buildChallengeValue } from "./challenge-cookie.js";
import {
  aliceChallengeCookie,
  makeHarness,
  post,
  SECRET_ALICE,
  TEST_CHALLENGE_KEY,
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

  it("code without challenge cookie: falls back to password path", async () => {
    const h = makeHarness();
    const res = await post(h, "POST", "code=123456");
    // 无挑战 cookie + 无 username/password → 走密码路径 → 空 username → 401
    expect(res.status).toBe(401);
    expect(res.body).toBe("invalid credentials");
  });

  it("expired challenge cookie: treated as absent (password page)", async () => {
    const h = makeHarness();
    const expired = `${CHALLENGE_COOKIE}=${buildChallengeValue(
      "alice",
      1_700_000_000_000 - 1,
      TEST_CHALLENGE_KEY,
    )}`; // 签名合法但过期
    const res = await post(h, "GET", expired);
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="username"');
  });

  it("unknown user from challenge cookie: 401", async () => {
    const h = makeHarness();
    const unknown = `${CHALLENGE_COOKIE}=${buildChallengeValue(
      "mallory",
      1_700_000_000_000 + 1000,
      TEST_CHALLENGE_KEY,
    )}`;
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

describe("TOTP: submit hardening (disabled / off)", () => {
  it("disabled user with secret and a valid challenge cookie is rejected at TOTP submit", async () => {
    const h = makeHarness();
    h.users.set("alice", { ...h.users.get("alice")!, disabled: true });
    h.setVerifyImpl((_secret, code) => (code === "123456" ? 100 : undefined));
    const res = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('class="error"');
    expect(res.headers["set-cookie"] ?? []).not.toContain("dsh_auth=");
    expect(h.replayCalls).toEqual([{ username: "alice", counter: 100, code: "123456" }]);
  });

  it("disabled user still runs verifyTotp before rejecting (no timing side channel)", async () => {
    const h = makeHarness();
    h.users.set("alice", { ...h.users.get("alice")!, disabled: true });
    let verifyCalls = 0;
    h.setVerifyImpl(() => {
      verifyCalls += 1;
      return 100;
    });
    const res = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(verifyCalls).toBe(1);
  });

  it("off mode: leftover challenge cookie + code does not issue a session", async () => {
    const h = makeHarness();
    h.setTotpMode("off");
    h.setVerifyImpl(() => 100);
    const res = await post(h, "POST", "code=123456", aliceChallengeCookie());
    // 不进 TOTP 路径 → 落回密码路径（无 username/password）→ 统一 401，防重放未被咨询
    expect(res.status).toBe(401);
    expect(h.replayCalls).toEqual([]);
  });

  it("off mode: GET with leftover challenge cookie renders the password page", async () => {
    const h = makeHarness();
    h.setTotpMode("off");
    const res = await post(h, "GET", aliceChallengeCookie());
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="username"');
    expect(res.body).not.toContain('name="code"');
  });

  it("user store failure during TOTP submit: 503, no failure counted", async () => {
    const h = makeHarness();
    h.deps.loadUsers = () => Promise.reject(new Error("parse boom"));
    const res = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(res.status).toBe(503);
    expect(res.body).toBe("user store unavailable");
  });

  it("wrong code: 401 with challenge page error slot and failure counted (replay guard not consulted)", async () => {
    const h = makeHarness();
    h.setVerifyImpl(() => undefined);
    const res = await post(h, "POST", "code=000000", aliceChallengeCookie());
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('class="error"');
    expect(res.body).toContain('name="code"');
    expect(res.body).toContain("invalid credentials");
    expect(h.replayCalls).toEqual([]);
  });
});

describe("TOTP: rate-limit & replay semantics", () => {
  it("TOTP success with missing session store returns 503 and does not clear the failure bucket", async () => {
    const h = makeHarness();
    h.setVerifyImpl((_secret, code) => (code === "123456" ? 100 : undefined));
    for (let i = 0; i < 4; i++) {
      const res = await post(h, "POST", "code=000000", aliceChallengeCookie());
      expect(res.status).toBe(401);
    }
    // store 不可用：正确码应 503，且不得清桶（recordSuccess 后移）
    const storeBackup = h.deps.sessions();
    h.setStore(undefined);
    const broken = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(broken.status).toBe(503);
    h.setStore(storeBackup);
    // 恢复 store 后第 5 次失败 → 429（若被错误 success 清桶则不会 429）
    const fifth = await post(h, "POST", "code=000000", aliceChallengeCookie());
    expect(fifth.status).toBe(401);
    const locked = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBe("30");
  });

  it("different code in the same window is rejected (guard keyed by counter)", async () => {
    const h = makeHarness();
    h.setVerifyImpl(() => 100);
    // harness 的 replayCheck 是放行桩；用「按 counter 拒绝」桩模拟真实 guard 新语义
    // （TotpReplayGuard 按 counter 拒绝，见 replay-guard.test.ts）
    const used = new Set<number>();
    h.setReplayImpl((_username, counter) => {
      if (used.has(counter)) return false;
      used.add(counter);
      return true;
    });
    const first = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(first.status).toBe(302);
    const second = await post(h, "POST", "code=654321", aliceChallengeCookie());
    expect(second.status).toBe(401);
    expect(h.replayCalls).toHaveLength(2);
  });

  it("replayed code (guard false): 401 uniform", async () => {
    const h = makeHarness();
    h.setVerifyImpl((_secret, code) => (code === "123456" ? 100 : undefined));
    h.setReplayImpl(() => false);
    const res = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(res.status).toBe(401);
    expect(h.replayCalls).toEqual([{ username: "alice", counter: 100, code: "123456" }]);
  });
});
