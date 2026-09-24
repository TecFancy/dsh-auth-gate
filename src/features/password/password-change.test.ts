import { describe, expect, it, vi } from "vitest";
import {
  CURRENT,
  GOOD_BODY,
  NEW_PASSWORD,
  activeUser,
  formBody,
  jsonBody,
  makeHarness,
  makeReq,
  makeRes,
  send,
} from "../../../test/password-change-harness.js";
import { handlePasswordChange } from "./password-change.js";

describe("rows 1-3: method and body gates", () => {
  it("row 1: non-POST → 405 + allow: POST + no-store", async () => {
    const res = await send(makeHarness().deps, { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("row 2: non-urlencoded content-type → 415", async () => {
    const res = await send(makeHarness().deps, { contentType: "application/json", body: "{}" });
    expect(res.status).toBe(415);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("row 3: body over 16 KiB → 413 with connection: close", async () => {
    const res = await send(makeHarness().deps, { body: Buffer.alloc(16 * 1024 + 1, 0x61) });
    expect(res.status).toBe(413);
    expect(res.headers["connection"]).toBe("close");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("rows 4-5: session and rate limit", () => {
  it("row 4: no cookie → 401 unauthorized", async () => {
    const res = await send(makeHarness().deps, { cookie: null, body: GOOD_BODY });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "unauthorized" });
  });

  it("row 4: unknown/expired cookie → 401 unauthorized", async () => {
    const res = await send(makeHarness().deps, { cookie: "dsh_auth=stale", body: GOOD_BODY });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "unauthorized" });
  });

  it("row 4: unavailable session store → 401 unauthorized", async () => {
    const res = await send(makeHarness({ sessions: () => undefined }).deps, { body: GOOD_BODY });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "unauthorized" });
  });

  it("row 4: Bearer alone is not a session (cookie-only, M5)", async () => {
    const { deps } = makeHarness();
    const req = makeReq({ cookie: null, body: GOOD_BODY });
    req.headers.authorization = "Bearer good";
    const res = makeRes();
    await handlePasswordChange(deps, req, res.res);
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "unauthorized" });
  });

  it("row 5: locked bucket → 429 + retry-after + locked body", async () => {
    const { deps } = makeHarness({ verify: () => Promise.resolve(false) });
    const bad = formBody({ current: "wrong", password: NEW_PASSWORD });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await send(deps, { body: bad })).status).toBe(401);
    }
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(429);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(jsonBody(res)).toEqual({
      error: "locked",
      retryAfter: Number(res.headers["retry-after"]),
    });
  });
});

describe("rows 6-7: credential and policy rejections", () => {
  it("row 6: wrong current password → 401 invalid_credentials", async () => {
    const { deps, state } = makeHarness();
    const res = await send(deps, { body: formBody({ current: "nope", password: NEW_PASSWORD }) });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "invalid_credentials" });
    expect(state.writes).toBe(0);
    expect(state.revokes).toBe(0);
  });

  it("row 6: unknown user → 401 and the dummy hash is verified", async () => {
    const verify = vi.fn(() => Promise.resolve(true));
    const res = await send(makeHarness({ verify }, null).deps, { body: GOOD_BODY });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "invalid_credentials" });
    expect(verify).toHaveBeenCalledWith(CURRENT, expect.stringContaining("scrypt$"));
  });

  it("row 6: disabled user with the correct password → 401 (real hash still runs)", async () => {
    const verify = vi.fn(() => Promise.resolve(true));
    const { deps } = makeHarness({ verify }, activeUser({ disabled: true }));
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "invalid_credentials" });
    expect(verify).toHaveBeenCalledWith(CURRENT, activeUser().passwordHash);
  });

  it("row 7: policy failure → 400 with the failed rules", async () => {
    const { deps, state } = makeHarness();
    const res = await send(deps, { body: formBody({ current: CURRENT, password: "short" }) });
    expect(res.status).toBe(400);
    expect(jsonBody(res)).toEqual({
      error: "policy",
      rules: ["minLength", "uppercase", "digit", "special"],
    });
    expect(state.writes).toBe(0);
  });

  it("row 7: reusing the old password → 400 with sameAsOld", async () => {
    const { deps } = makeHarness({
      verify: (password) => Promise.resolve(password === CURRENT || password === NEW_PASSWORD),
    });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(400);
    expect(jsonBody(res)).toEqual({ error: "policy", rules: ["sameAsOld"] });
  });

  it("row 7 + C2: repeated policy failures lock the change bucket (429)", async () => {
    const { deps } = makeHarness();
    const weak = formBody({ current: CURRENT, password: "short" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await send(deps, { body: weak })).status).toBe(400);
    }
    expect((await send(deps, { body: weak })).status).toBe(429);
    expect((await send(deps, { body: GOOD_BODY })).status).toBe(429);
  });
});

describe("row 8: TOTP (§4.1)", () => {
  it("row 8: TOTP user without a code → 401 invalid_totp", async () => {
    const { deps, state } = makeHarness(
      { totpMode: "optional", verifyTotp: () => undefined },
      activeUser({ totpSecret: "SECRET" }),
    );
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "invalid_totp" });
    expect(state.writes).toBe(0);
  });

  it("row 8: TOTP replay in the same window → 401 invalid_totp", async () => {
    const replayCheck = vi.fn(() => false);
    const { deps } = makeHarness(
      { totpMode: "optional", verifyTotp: () => 7, replayCheck },
      activeUser({ totpSecret: "SECRET" }),
    );
    const res = await send(deps, { body: formBody({ ...bodyValues(), code: "123456" }) });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "invalid_totp" });
    expect(replayCheck).toHaveBeenCalledWith("alice", 7, "123456");
  });

  it("row 8 + A2: required mode without a secret → 401 invalid_totp", async () => {
    const { deps, state } = makeHarness({ totpMode: "required" });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "invalid_totp" });
    expect(state.writes).toBe(0);
  });

  it("row 8 + A9: off mode ignores the secret and a stale code field (T4)", async () => {
    const { deps } = makeHarness(
      { totpMode: "off", verifyTotp: () => undefined },
      activeUser({ totpSecret: "SECRET" }),
    );
    const res = await send(deps, { body: formBody({ ...bodyValues(), code: "000000" }) });
    expect(res.status).toBe(200);
  });

  it("row 8 + A2/A4: TOTP failures count and eventually lock the bucket", async () => {
    const { deps } = makeHarness(
      { totpMode: "optional", verifyTotp: () => undefined },
      activeUser({ totpSecret: "SECRET" }),
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await send(deps, { body: GOOD_BODY })).status).toBe(401);
    }
    expect((await send(deps, { body: GOOD_BODY })).status).toBe(429);
  });

  it("row 8: a valid code succeeds in optional mode", async () => {
    const { deps, state } = makeHarness(
      { totpMode: "optional", verifyTotp: () => 7, replayCheck: () => true },
      activeUser({ totpSecret: "SECRET" }),
    );
    const res = await send(deps, { body: formBody({ ...bodyValues(), code: "123456" }) });
    expect(res.status).toBe(200);
    expect(state.revokes).toBe(1);
  });
});

describe("row 9: users file failures", () => {
  it("row 9: users read failure → 503 text/plain", async () => {
    const { deps } = makeHarness({
      loadUsers: () => Promise.reject(new Error("invalid users file")),
    });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toBe("text/plain");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("row 9: write failure → 503 text/plain and no revoke", async () => {
    const { deps, state } = makeHarness({
      mutateUsers: () => Promise.reject(new Error("users file is locked")),
    });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toBe("text/plain");
    expect(state.revokes).toBe(0);
  });

  it("row 9 + A6: a concurrent change detected in the lock → 503", async () => {
    const { deps, state } = makeHarness({
      // 锁内快照的旧 hash 已被他人改掉 → 复核拒绝覆盖写入。
      verify: (password, hash) =>
        Promise.resolve(password === CURRENT && hash === activeUser().passwordHash),
      mutateUsers: async (mutator) => {
        await mutator({
          users: new Map([["alice", activeUser({ passwordHash: "moved-by-someone-else" })]]),
        });
      },
    });
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(503);
    expect(state.revokes).toBe(0);
  });
});

describe("row 10: success", () => {
  it("writes the new hash, revokes every session and clears the cookie", async () => {
    const { deps, users, store, state } = makeHarness();
    const res = await send(deps, { body: GOOD_BODY });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(jsonBody(res)).toEqual({ ok: true });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["set-cookie"]).toBe("dsh_auth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    expect(users.get("alice")?.passwordHash).toBe("scrypt$65536$8$1$new");
    expect(state.writes).toBe(1);
    expect(state.revokes).toBe(1);
    expect(store.has("good")).toBe(false); // 全踢含当前会话
  });

  it("clears the cookie with the Secure flag when configured", async () => {
    const res = await send(makeHarness({ cookieSecure: true }).deps, { body: GOOD_BODY });
    expect(res.headers["set-cookie"]).toBe(
      "dsh_auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });
});

function bodyValues(): Record<string, string> {
  return { current: CURRENT, password: NEW_PASSWORD };
}
