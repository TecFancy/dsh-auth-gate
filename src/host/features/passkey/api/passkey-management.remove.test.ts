import { describe, expect, it } from "vitest";
import { PASSKEY_REMOVE_PATH } from "../../../shared/protocol/index.js";
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

/** 已登录用户 + 指定数量的凭据。 */
async function setup(
  harness: ManagementHarness,
  count: number,
  overrides: Parameters<typeof makeUser>[0] = {},
): Promise<{ cookie: string; records: ReturnType<typeof makePasskeyRecord>[] }> {
  const records = Array.from({ length: count }, (_unused, index) =>
    makePasskeyRecord({ createdAt: index + 1, label: `Key ${index + 1}` }),
  );
  harness.users.set("alice", makeUser({ passkeys: records, ...overrides }));
  return { cookie: await harness.issueSessionCookie("alice"), records };
}

describe("passkey remove", () => {
  it("removes one credential by unique prefix without re-authentication", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const { cookie, records } = await setup(harness, 2);
    const res = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id: records[0]!.credentialId.slice(0, 8) },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, removed: 1 });
  });

  it("keeps the other credentials after a single removal", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const { cookie, records } = await setup(harness, 2);
    await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id: records[0]!.credentialId.slice(0, 8) },
    });
    const remaining = harness.users.get("alice")!.passkeys!;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.credentialId).toBe(records[1]!.credentialId);
  });

  it("answers 404 for an unknown prefix and 400 for an ambiguous one", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const { cookie } = await setup(harness, 2);
    const missing = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id: "zzzzzzzz" },
    });
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body)).toEqual({ error: "not_found" });
    const short = await send(harness, PASSKEY_REMOVE_PATH, { cookie, fields: { id: "abc" } });
    expect(short.status).toBe(404);

    const shared = "sharedprefix";
    harness.users.set(
      "alice",
      makeUser({
        passkeys: [
          makePasskeyRecord({ credentialId: `${shared}aaaa` }),
          makePasskeyRecord({ credentialId: `${shared}bbbb` }),
        ],
      }),
    );
    const ambiguous = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id: shared },
    });
    expect(ambiguous.status).toBe(400);
    expect(JSON.parse(ambiguous.body)).toEqual({ error: "bad_request", reason: "ambiguous-id" });
  });
});

describe("passkey remove: re-authentication", () => {
  it("requires re-authentication to remove the last credential", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const { cookie, records } = await setup(harness, 1);
    const id = records[0]!.credentialId.slice(0, 8);
    expect((await send(harness, PASSKEY_REMOVE_PATH, { cookie, fields: { id } })).status).toBe(401);
    expect(harness.users.get("alice")!.passkeys).toHaveLength(1);
    const wrong = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id, password: "nope" },
    });
    expect(wrong.status).toBe(401);
    const ok = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id, password: TEST_PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect(harness.users.get("alice")!.passkeys).toEqual([]);
  });

  it("requires re-authentication with a TOTP code when the user has a secret", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const { cookie, records } = await setup(harness, 1, { totpSecret: TEST_TOTP_SECRET });
    const noCode = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id: records[0]!.credentialId.slice(0, 8), password: TEST_PASSWORD },
    });
    expect(noCode.status).toBe(401);
    const ok = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: {
        id: records[0]!.credentialId.slice(0, 8),
        password: TEST_PASSWORD,
        code: "123456",
      },
    });
    expect(ok.status).toBe(200);
  });

  it("requires re-authentication for all=1 and clears every credential", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const { cookie } = await setup(harness, 3);
    const denied = await send(harness, PASSKEY_REMOVE_PATH, { cookie, fields: { all: "1" } });
    expect(denied.status).toBe(401);
    expect(harness.users.get("alice")!.passkeys).toHaveLength(3);
    const ok = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { all: "1", password: TEST_PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, removed: 3 });
    expect(harness.users.get("alice")!.passkeys).toEqual([]);
  });

  it("keeps the user handle after removing every credential", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const handle = "handle-handle-handle-handle-handle-1234";
    const { cookie } = await setup(harness, 1, { passkeyUserHandle: handle });
    const res = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { all: "1", password: TEST_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(harness.users.get("alice")!.passkeyUserHandle).toBe(handle);
  });

  it("answers 503 when the write fails", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const { cookie, records } = await setup(harness, 2);
    harness.setWriteFailure(true);
    const res = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id: records[0]!.credentialId.slice(0, 8) },
    });
    expect(res.status).toBe(503);
  });
});
