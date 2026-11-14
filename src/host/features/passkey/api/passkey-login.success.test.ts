import { describe, expect, it } from "vitest";
import type { PasskeyRecord, UserRecord } from "../../../entities/user/index.js";
import { PASSKEY_LOGIN_PATH, PASSKEY_OPTIONS_PATH } from "../../../shared/protocol/index.js";
import { makeReq, makeRes, type FakeRes } from "../../../../../test/token-endpoints-harness.js";
import {
  PasskeyAuthenticator,
  makePasskeyLoginHarness,
  randomBase64Url,
  routeHandler,
  TEST_CLIENT_IP,
  TEST_ORIGIN,
  TEST_RP_ID,
  TEST_SESSION_COOKIE,
  type AssertionOptions,
  type PasskeyLoginHarness,
} from "../../../../../test/passkey-authenticator-harness.js";
import { registerPasskeyLoginEndpoints } from "./passkey-login-endpoints.js";

const CLEAR_COOKIE = "dsh_auth_pk=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Lax";

async function begin(harness: PasskeyLoginHarness): Promise<{ challenge: string; cookie: string }> {
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
    makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
    res.res,
  );
  const body = JSON.parse(res.body) as { challenge: string };
  const cookie = res.headers["set-cookie"]!.split(";")[0]!;
  return { challenge: body.challenge, cookie };
}

/** 走一次 begin + finish；`next` 缺省不带，`overrides` 透传给认证器。 */
async function login(
  harness: PasskeyLoginHarness,
  authenticator: PasskeyAuthenticator,
  overrides: Partial<AssertionOptions> = {},
  next?: string,
): Promise<FakeRes> {
  const opened = await begin(harness);
  const fields = authenticator.assert({
    challenge: opened.challenge,
    origin: TEST_ORIGIN,
    ...overrides,
  });
  const params = new URLSearchParams();
  params.set("id", fields.id);
  params.set("client_data_json", fields.client_data_json);
  params.set("authenticator_data", fields.authenticator_data);
  params.set("signature", fields.signature);
  if (fields.user_handle !== undefined) params.set("user_handle", fields.user_handle);
  if (next !== undefined) params.set("next", next);
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_LOGIN_PATH)(
    makeReq({
      method: "POST",
      url: PASSKEY_LOGIN_PATH,
      cookie: opened.cookie,
      contentType: "application/x-www-form-urlencoded",
      body: Buffer.from(params.toString()),
    }),
    res.res,
  );
  return res;
}

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

function warnMessages(harness: PasskeyLoginHarness): string {
  return harness.logs
    .filter((entry) => entry.level === "warn")
    .map((entry) => String(entry.message))
    .join("\n");
}

function freshAuthenticator(): PasskeyAuthenticator {
  return new PasskeyAuthenticator({ rpId: TEST_RP_ID, userHandle: randomBase64Url(32) });
}

describe("POST /auth/passkey/login: success path", () => {
  it("issues a full session, clears the ceremony cookie and logs the credential prefix", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));
    const res = await login(harness, authenticator, { counter: 1 }, "/__probe");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/__probe");
    expect(res.headers["set-cookie"]).toContain(TEST_SESSION_COOKIE);
    expect(res.headers["set-cookie"]).toContain(CLEAR_COOKIE);
    expect(harness.issued).toEqual([
      { username: "alice", next: "/__probe", extra: [CLEAR_COOKIE] },
    ]);
    expect(harness.limiter.check(TEST_CLIENT_IP, "alice").allowed).toBe(true);
    expect(harness.logs).toContainEqual({
      level: "info",
      message: `passkey login succeeded: alice (credential ${authenticator.credentialId.slice(0, 8)})`,
    });
  });

  it("sanitizes an off-site next back to /", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));
    const res = await login(harness, authenticator, {}, "//evil.example/steal");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
    expect(harness.issued[0]?.next).toBe("/");
  });
});

describe("POST /auth/passkey/login: counter policy", () => {
  it("allows a counter regression with a warning when enforcement is off", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator, { signCount: 5 }));
    expect((await login(harness, authenticator, { counter: 3 })).status).toBe(302);
    expect(warnMessages(harness)).toContain("counter regression allowed for alice");
  });

  it("allows a regression for a synced passkey even with enforcement on", async () => {
    const harness = makePasskeyLoginHarness({ enforceCounter: true });
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator, { signCount: 5, be: true, bs: true }));
    expect((await login(harness, authenticator, { counter: 3, flags: 0x1d })).status).toBe(302);
    expect(warnMessages(harness)).toContain("counter regression allowed for alice");
  });

  it("keeps the in-memory counter so a later lower counter looks like a regression", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator, { signCount: 0 }));
    expect((await login(harness, authenticator, { counter: 5 })).status).toBe(302);
    expect((await login(harness, authenticator, { counter: 3 })).status).toBe(302);
    expect(warnMessages(harness)).toContain("counter regression allowed for alice");
  });
});
