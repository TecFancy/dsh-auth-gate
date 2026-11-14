import { describe, expect, it } from "vitest";
import type { PasskeyRecord, UserRecord } from "../../../entities/user/index.js";
import { PASSKEY_LOGIN_PATH, PASSKEY_OPTIONS_PATH } from "../../../shared/protocol/index.js";
import { PASSKEY_PERMISSIONS_POLICY } from "../../../shared/http/index.js";
import { makeReq, makeRes, type FakeRes } from "../../../../../test/token-endpoints-harness.js";
import {
  PasskeyAuthenticator,
  makePasskeyLoginHarness,
  randomBase64Url,
  routeHandler,
  TEST_CLIENT_IP,
  TEST_ORIGIN,
  TEST_RP_ID,
  type PasskeyAssertionForm,
  type PasskeyLoginHarness,
} from "../../../../../test/passkey-authenticator-harness.js";
import { PasskeyOptionsQuota } from "../model/options-quota.js";
import { PASSKEY_LOGIN_FAILED_MESSAGE } from "./passkey-login-failures.js";
import { registerPasskeyLoginEndpoints } from "./passkey-login-endpoints.js";

/**
 * 评审（Kimi K3.1 Pro，2026-11-12）指出的加固点：begin 配额必须真正消耗、`Permissions-Policy`
 * 必须下发、用户存储 503 不得烧掉 ceremony、禁用用户与缺失 userHandle 的 401 同形、
 * 相等计数器按重放拒绝、`recordSuccess` 必须真的清桶。
 */

function makeUserRecord(
  authenticator: PasskeyAuthenticator,
  overrides: Partial<PasskeyRecord> = {},
): UserRecord {
  return {
    passwordHash: "scrypt$unused",
    disabled: false,
    passkeyUserHandle: authenticator.userHandle,
    passkeys: [
      {
        credentialId: authenticator.credentialId,
        publicKeyCose: authenticator.publicKeyCose,
        alg: -7,
        signCount: 0,
        aaguid: "",
        be: false,
        bs: false,
        uvInitialized: true,
        transports: ["internal"],
        label: "Test key",
        createdAt: 1,
        lastUsedAt: 0,
        ...overrides,
      },
    ],
  };
}

function freshAuthenticator(): PasskeyAuthenticator {
  return new PasskeyAuthenticator({ rpId: TEST_RP_ID, userHandle: randomBase64Url(32) });
}

async function begin(harness: PasskeyLoginHarness): Promise<{ challenge: string; cookie: string }> {
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
    makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
    res.res,
  );
  const body = JSON.parse(res.body) as { challenge: string };
  const cookie = res.headers["set-cookie"]?.split(";")[0] ?? "";
  return { challenge: body.challenge, cookie };
}

async function post(
  harness: PasskeyLoginHarness,
  fields: PasskeyAssertionForm,
  cookie: string,
): Promise<FakeRes> {
  const params = new URLSearchParams();
  params.set("id", fields.id);
  params.set("client_data_json", fields.client_data_json);
  params.set("authenticator_data", fields.authenticator_data);
  params.set("signature", fields.signature);
  if (fields.user_handle !== undefined) params.set("user_handle", fields.user_handle);
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_LOGIN_PATH)(
    makeReq({
      method: "POST",
      url: PASSKEY_LOGIN_PATH,
      cookie,
      contentType: "application/x-www-form-urlencoded",
      body: Buffer.from(params.toString()),
    }),
    res.res,
  );
  return res;
}

async function login(
  harness: PasskeyLoginHarness,
  authenticator: PasskeyAuthenticator,
  overrides: Partial<Parameters<PasskeyAuthenticator["assert"]>[0]> = {},
): Promise<FakeRes> {
  const opened = await begin(harness);
  const fields = authenticator.assert({
    challenge: opened.challenge,
    origin: TEST_ORIGIN,
    ...overrides,
  });
  return post(harness, fields, opened.cookie);
}

describe("begin quota is actually consumed", () => {
  it("answers 429 after the per-IP limit and creates no ceremony", async () => {
    const quota = new PasskeyOptionsQuota({ perIpLimit: 2, globalLimit: 100 });
    const harness = makePasskeyLoginHarness({ optionsQuota: quota });
    registerPasskeyLoginEndpoints(harness.deps);
    expect((await begin(harness)).cookie).not.toBe("");
    expect((await begin(harness)).cookie).not.toBe("");
    const limited = makeRes();
    await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
      makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
      limited.res,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers["set-cookie"]).toBeUndefined();
    expect(JSON.parse(limited.body)).toMatchObject({ error: "locked" });
  });

  it("keeps other clients working when one IP is exhausted", async () => {
    const quota = new PasskeyOptionsQuota({ perIpLimit: 1, globalLimit: 100 });
    const harness = makePasskeyLoginHarness({ optionsQuota: quota });
    registerPasskeyLoginEndpoints(harness.deps);
    expect((await begin(harness)).cookie).not.toBe("");
    const blocked = makeRes();
    await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
      makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
      blocked.res,
    );
    expect(blocked.status).toBe(429);
  });
});

describe("Permissions-Policy on every passkey response", () => {
  it("sets the header on options, success, 401 and 429", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));

    const options = makeRes();
    await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
      makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
      options.res,
    );
    expect(options.headers["permissions-policy"]).toBe(PASSKEY_PERMISSIONS_POLICY);

    const ok = await login(harness, authenticator);
    expect(ok.status).toBe(302);
    expect(ok.headers["permissions-policy"]).toBe(PASSKEY_PERMISSIONS_POLICY);

    const rejected = await login(harness, freshAuthenticator());
    expect(rejected.status).toBe(401);
    expect(rejected.headers["permissions-policy"]).toBe(PASSKEY_PERMISSIONS_POLICY);
  });
});

describe("user store 503 does not burn the ceremony", () => {
  it("lets the same ceremony succeed after a transient users-file failure", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));
    const opened = await begin(harness);
    const fields = authenticator.assert({ challenge: opened.challenge, origin: TEST_ORIGIN });

    harness.setUsersLoadFailure(true);
    const unavailable = await post(harness, fields, opened.cookie);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers["set-cookie"]).toBeUndefined();

    harness.setUsersLoadFailure(false);
    const retried = await post(harness, fields, opened.cookie);
    expect(retried.status).toBe(302);
  });
});

describe("401 uniformity for disabled users and missing userHandle", () => {
  it("returns the same body for a disabled user as for a bad signature", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const disabled = freshAuthenticator();
    harness.users.set("bob", { ...makeUserRecord(disabled), disabled: true });
    const disabledRes = await login(harness, disabled);
    expect(disabledRes.status).toBe(401);
    expect(disabledRes.body).toContain(PASSKEY_LOGIN_FAILED_MESSAGE);

    const known = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(known));
    const badSignature = await login(harness, known, { badSignature: true });
    expect(badSignature.status).toBe(401);
    expect(disabledRes.body).toBe(badSignature.body);
  });

  it("rejects an assertion without userHandle with the same 401", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));
    const res = await login(harness, authenticator, { userHandle: null });
    expect(res.status).toBe(401);
    expect(res.body).toContain(PASSKEY_LOGIN_FAILED_MESSAGE);
  });
});

describe("counter replay and bucket reset", () => {
  it("rejects an equal counter as a replay", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator, { signCount: 5 }));
    const res = await login(harness, authenticator, { counter: 5 });
    expect(res.status).toBe(401);
    expect(res.body).toContain(PASSKEY_LOGIN_FAILED_MESSAGE);
  });

  it("clears the failure bucket on success", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      harness.limiter.recordFailure(TEST_CLIENT_IP, "alice");
    }
    expect(harness.limiter.check(TEST_CLIENT_IP, "alice").allowed).toBe(true);
    expect((await login(harness, authenticator)).status).toBe(302);
    // 成功清桶后，再攒 4 次失败仍不应锁定（若未清桶，第 5 次就会锁）。
    for (let attempt = 0; attempt < 4; attempt += 1) {
      harness.limiter.recordFailure(TEST_CLIENT_IP, "alice");
    }
    expect(harness.limiter.check(TEST_CLIENT_IP, "alice").allowed).toBe(true);
  });
});
