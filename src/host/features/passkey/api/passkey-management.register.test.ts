import { describe, expect, it } from "vitest";
import { PASSKEY_REGISTER_OPTIONS_PATH } from "../../../shared/protocol/index.js";
import { registerPasskeyEndpoints } from "./passkey-endpoints.js";
import {
  makeManagementHarness,
  makePasskeyRecord,
  makeUser,
  managementHandler,
  TEST_PASSWORD,
  TEST_TOTP_SECRET,
  type ManagementHarness,
} from "../../../../../test/passkey-management-harness.js";
import {
  formBody,
  makeManagementRes,
  managementRequest,
} from "../../../../../test/passkey-management-http-harness.js";
import { randomBase64Url, TEST_RP_ID } from "../../../../../test/passkey-authenticator-harness.js";

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

describe("passkey register options", () => {
  it("returns the library options verbatim plus a register ceremony cookie", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const sessionCookie = await harness.issueSessionCookie("alice");
    const res = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie: sessionCookie,
      fields: { label: "  My key  ", password: TEST_PASSWORD, code: "123456" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body["rp"]).toEqual({ id: TEST_RP_ID, name: "DeepSeek Harness" });
    expect(body["user"]).toMatchObject({ name: "alice" });
    expect(body["attestation"]).toBe("none");
    expect(body["authenticatorSelection"]).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    expect(body["pubKeyCredParams"]).toEqual(
      expect.arrayContaining([{ alg: -7, type: "public-key" }]),
    );
    expect(res.headers["set-cookie"]).toMatch(/^dsh_auth_pk=/);
  });

  it("stores the trimmed label and the library challenge in the ceremony", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const sessionCookie = await harness.issueSessionCookie("alice");
    const res = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie: sessionCookie,
      fields: { label: "  My key  ", password: TEST_PASSWORD },
    });
    const body = JSON.parse(res.body) as { challenge: string };
    const ceremonyId = res.headers["set-cookie"]!.split(";")[0]!.split("=")[1]!;
    const ceremony = harness.ceremony.consume(ceremonyId);
    expect(ceremony).toMatchObject({ kind: "register", userId: "alice", label: "My key" });
    expect(Buffer.from(ceremony!.challenge).toString("base64url")).toBe(body.challenge);
  });

  it("excludes existing credentials and reuses the stored user handle", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const existing = makePasskeyRecord({ transports: ["usb"] });
    const handle = randomBase64Url(32);
    harness.users.set("alice", makeUser({ passkeyUserHandle: handle, passkeys: [existing] }));
    const sessionCookie = await harness.issueSessionCookie("alice");
    const res = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie: sessionCookie,
      fields: { label: "Second", password: TEST_PASSWORD },
    });
    const body = JSON.parse(res.body) as {
      excludeCredentials: { id: string; transports: string[] }[];
      user: { id: string };
    };
    expect(body.excludeCredentials).toEqual([
      { id: existing.credentialId, type: "public-key", transports: ["usb"] },
    ]);
    expect(body.user.id).toBe(handle);
  });
});

describe("passkey register options: re-authentication", () => {
  it("rejects a wrong password and a wrong TOTP code", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser({ totpSecret: TEST_TOTP_SECRET }));
    const sessionCookie = await harness.issueSessionCookie("alice");
    const wrongPassword = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie: sessionCookie,
      fields: { label: "Key", password: "nope", code: "123456" },
    });
    expect(wrongPassword.status).toBe(401);
    const wrongCode = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie: sessionCookie,
      fields: { label: "Key", password: TEST_PASSWORD, code: "000000" },
    });
    expect(wrongCode.status).toBe(401);
    harness.setTotpFailure(true);
    const replay = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie: sessionCookie,
      fields: { label: "Key", password: TEST_PASSWORD, code: "123456" },
    });
    expect(replay.status).toBe(401);
  });

  it("rejects an empty, blank or over-long label with 400", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const sessionCookie = await harness.issueSessionCookie("alice");
    for (const label of ["", "   ", "x".repeat(65)]) {
      const res = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
        cookie: sessionCookie,
        fields: { label, password: TEST_PASSWORD },
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: "bad_request", reason: "invalid-label" });
    }
  });

  it("skips the TOTP check when the user has no secret", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const sessionCookie = await harness.issueSessionCookie("alice");
    const res = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie: sessionCookie,
      fields: { label: "Key", password: TEST_PASSWORD, code: "" },
    });
    expect(res.status).toBe(200);
  });
});
