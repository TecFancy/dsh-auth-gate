import { describe, expect, it } from "vitest";
import type { PasskeyRecord, UserRecord } from "../../../entities/user/index.js";
import { PASSKEY_LOGIN_PATH, PASSKEY_OPTIONS_PATH } from "../../../shared/protocol/index.js";
import { makeReq, makeRes, type FakeRes } from "../../../../../test/token-endpoints-harness.js";
import {
  PasskeyAuthenticator,
  makePasskeyLoginHarness,
  randomBase64Url,
  routeHandler,
  TEST_ORIGIN,
  TEST_RP_ID,
  type PasskeyAssertionForm,
  type PasskeyLoginHarness,
} from "../../../../../test/passkey-authenticator-harness.js";
import { PASSKEY_LOGIN_FAILED_MESSAGE } from "./passkey-login-failures.js";
import { registerPasskeyLoginEndpoints } from "./passkey-login-endpoints.js";

interface OpenedCeremony {
  readonly challenge: string;
  readonly cookie: string;
}

async function begin(harness: PasskeyLoginHarness): Promise<OpenedCeremony> {
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
    makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
    res.res,
  );
  const body = JSON.parse(res.body) as { challenge: string };
  const cookie = res.headers["set-cookie"]!.split(";")[0]!;
  return { challenge: body.challenge, cookie };
}

/** 走一次完整 begin + finish，返回 finish 的响应。 */
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

function expectRejected(res: FakeRes): void {
  expect(res.status).toBe(401);
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.body).toContain(PASSKEY_LOGIN_FAILED_MESSAGE);
  expect(res.headers["set-cookie"]).toContain("dsh_auth_pk=; Max-Age=0");
  expect(res.headers["set-cookie"]).not.toContain("dsh_auth=fake-session");
  // 失败卡片保留 passkey 重试入口，同时口令表单照旧可用。
  expect(res.body).toContain('id="passkey-btn"');
  expect(res.body).toContain('name="password"');
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

describe("POST /auth/passkey/login: assertion policy rejections", () => {
  it("rejects unknown credentials and bad signatures with the same 401 body", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const known = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(known));
    const unknown = await login(harness, freshAuthenticator());
    expectRejected(unknown);
    const bad = await login(harness, known, { badSignature: true });
    expectRejected(bad);
    expect(bad.body).toBe(unknown.body);
    expect(warnMessages(harness)).toContain("unknown credential");
    expect(warnMessages(harness)).toContain("verification-failed");
  });

  it("rejects a userHandle that does not belong to the credential owner", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));
    expectRejected(await login(harness, authenticator, { userHandle: randomBase64Url(32) }));
    expect(warnMessages(harness)).toContain("user-handle-mismatch");
  });

  it("rejects a BE/BS state that differs from the registered record", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator));
    expectRejected(await login(harness, authenticator, { flags: 0x0d }));
    expect(warnMessages(harness)).toContain("backup-state-mismatch");
  });

  it("rejects a counter regression for a device-bound credential with enforcement on", async () => {
    const harness = makePasskeyLoginHarness({ enforceCounter: true });
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    harness.users.set("alice", makeUserRecord(authenticator, { signCount: 5 }));
    expectRejected(await login(harness, authenticator, { counter: 3 }));
    expect(warnMessages(harness)).toContain("counter-regression");
  });
});
