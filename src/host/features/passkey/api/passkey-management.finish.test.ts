import { describe, expect, it } from "vitest";
import {
  PASSKEY_REGISTER_OPTIONS_PATH,
  PASSKEY_REGISTER_PATH,
} from "../../../shared/protocol/index.js";
import { registerPasskeyEndpoints } from "./passkey-endpoints.js";
import {
  formBody,
  makeManagementRes,
  managementRequest,
} from "../../../../../test/passkey-management-http-harness.js";
import {
  makeManagementHarness,
  makePasskeyRecord,
  makeUser,
  managementHandler,
  TEST_PASSWORD,
  type ManagementHarness,
} from "../../../../../test/passkey-management-harness.js";
import {
  PasskeyAttestationAuthenticator,
  type PasskeyAttestationForm,
} from "../../../../../test/passkey-attestation-harness.js";
import {
  randomBase64Url,
  TEST_ORIGIN,
  TEST_RP_ID,
} from "../../../../../test/passkey-authenticator-harness.js";

function mount(harness: ManagementHarness): void {
  registerPasskeyEndpoints(harness.deps);
}

async function send(
  harness: ManagementHarness,
  path: string,
  options: {
    method?: string;
    cookie?: string;
    fields?: Record<string, string>;
  } = {},
): Promise<ReturnType<typeof makeManagementRes>> {
  const res = makeManagementRes();
  await managementHandler(harness.routes, path)(
    managementRequest({
      method: options.method ?? "POST",
      url: path,
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.fields === undefined ? {} : { body: formBody(options.fields) }),
    }),
    res.res,
  );
  return res;
}

/** 已登录用户 + 一条在途注册 ceremony（走 options 端点拿 challenge 与 cookie）。 */
async function beginRegistration(
  harness: ManagementHarness,
  options: { label?: string; password?: string; code?: string } = {},
): Promise<{ challenge: string; cookie: string; sessionCookie: string }> {
  const sessionCookie = await harness.issueSessionCookie("alice");
  const res = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
    cookie: sessionCookie,
    fields: {
      label: options.label ?? "My key",
      password: options.password ?? TEST_PASSWORD,
      code: options.code ?? "123456",
    },
  });
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body) as { challenge: string };
  const ceremonyCookie = res.headers["set-cookie"]!.split(";")[0]!;
  return { challenge: body.challenge, cookie: ceremonyCookie, sessionCookie };
}

/** 造一条注册 finish 的表单字段（认证器 attestation）。 */
function registrationFields(
  authenticator: PasskeyAttestationAuthenticator,
  challenge: string,
  transports = "internal,hybrid",
): Record<string, string> {
  const attestation: PasskeyAttestationForm = authenticator.attest({
    challenge,
    origin: TEST_ORIGIN,
  });
  return {
    id: attestation.id,
    client_data_json: attestation.client_data_json,
    attestation_object: attestation.attestation_object,
    transports,
  };
}

describe("passkey register finish", () => {
  it("verifies the attestation, writes users.yaml and returns the summary", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const authenticator = new PasskeyAttestationAuthenticator({ rpId: TEST_RP_ID });
    const begin = await beginRegistration(harness, { label: "My key" });
    const res = await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: `${begin.sessionCookie}; ${begin.cookie}`,
      fields: registrationFields(authenticator, begin.challenge),
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; passkey: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.passkey).toMatchObject({
      idPrefix: authenticator.credentialId.slice(0, 12),
      label: "My key",
      backupEligible: false,
      backupState: false,
      transports: ["internal", "hybrid"],
    });
    expect(res.headers["set-cookie"]).toContain("dsh_auth_pk=; Max-Age=0");
  });

  it("persists the credential record and the user handle", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const authenticator = new PasskeyAttestationAuthenticator({ rpId: TEST_RP_ID });
    const begin = await beginRegistration(harness, { label: "My key" });
    await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: `${begin.sessionCookie}; ${begin.cookie}`,
      fields: registrationFields(authenticator, begin.challenge),
    });
    const stored = harness.users.get("alice")!;
    expect(stored.passkeys).toHaveLength(1);
    expect(stored.passkeys![0]).toMatchObject({
      credentialId: authenticator.credentialId,
      publicKeyCose: authenticator.publicKeyCose,
      alg: -7,
      be: false,
      bs: false,
      uvInitialized: true,
      transports: ["internal", "hybrid"],
      label: "My key",
      lastUsedAt: 0,
    });
    expect(stored.passkeyUserHandle).toBeDefined();
  });
});

describe("passkey register finish: rejections", () => {
  it("rejects a missing, expired or foreign ceremony", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    harness.users.set("bob", makeUser());
    const authenticator = new PasskeyAttestationAuthenticator({ rpId: TEST_RP_ID });
    const begin = await beginRegistration(harness);
    const fields = registrationFields(authenticator, begin.challenge);
    const noCookie = await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: begin.sessionCookie,
      fields,
    });
    expect(noCookie.status).toBe(401);
    const bobCookie = await harness.issueSessionCookie("bob");
    const foreign = await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: `${bobCookie}; ${begin.cookie}`,
      fields,
    });
    expect(foreign.status).toBe(401);
  });

  it("rejects a tampered attestation with 401", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const authenticator = new PasskeyAttestationAuthenticator({ rpId: TEST_RP_ID });
    const begin = await beginRegistration(harness);
    const fields = registrationFields(authenticator, begin.challenge);
    const res = await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: `${begin.sessionCookie}; ${begin.cookie}`,
      fields: { ...fields, attestation_object: randomBase64Url(64) },
    });
    expect(res.status).toBe(401);
    expect(harness.users.get("alice")!.passkeys).toEqual([]);
  });

  it("rejects a duplicate credential and the 11th passkey inside the lock", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const authenticator = new PasskeyAttestationAuthenticator({ rpId: TEST_RP_ID });
    harness.users.set(
      "alice",
      makeUser({
        passkeys: [makePasskeyRecord({ credentialId: authenticator.credentialId })],
      }),
    );
    const begin = await beginRegistration(harness);
    const duplicate = await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: `${begin.sessionCookie}; ${begin.cookie}`,
      fields: registrationFields(authenticator, begin.challenge),
    });
    expect(duplicate.status).toBe(400);
    expect(JSON.parse(duplicate.body)).toMatchObject({ reason: "duplicate-credential" });

    const full = Array.from({ length: 10 }, () => makePasskeyRecord());
    harness.users.set("alice", makeUser({ passkeys: full }));
    const second = await beginRegistration(harness);
    const limit = await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: `${second.sessionCookie}; ${second.cookie}`,
      fields: registrationFields(authenticator, second.challenge),
    });
    expect(limit.status).toBe(400);
    expect(JSON.parse(limit.body)).toMatchObject({ reason: "too-many-passkeys" });
  });

  it("answers 503 when the write fails", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const authenticator = new PasskeyAttestationAuthenticator({ rpId: TEST_RP_ID });
    const begin = await beginRegistration(harness);
    harness.setWriteFailure(true);
    const res = await send(harness, PASSKEY_REGISTER_PATH, {
      cookie: `${begin.sessionCookie}; ${begin.cookie}`,
      fields: registrationFields(authenticator, begin.challenge),
    });
    expect(res.status).toBe(503);
  });
});
