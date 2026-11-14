import { describe, expect, it } from "vitest";
import {
  PASSKEY_PATH,
  PASSKEY_REGISTER_OPTIONS_PATH,
  PASSKEY_REGISTER_PATH,
  PASSKEY_REMOVE_PATH,
  PASSKEY_SETTINGS_PATH,
} from "../../../shared/protocol/index.js";
import { registerPasskeyEndpoints } from "./passkey-endpoints.js";
import {
  makeManagementHarness,
  makePasskeyRecord,
  makeUser,
  managementHandler,
  TEST_PASSWORD,
  type ManagementHarness,
} from "../../../../../test/passkey-management-harness.js";
import {
  formBody,
  makeManagementRes,
  managementRequest,
} from "../../../../../test/passkey-management-http-harness.js";

/** 注册全部 7 条路由（管理用例只关心其中 5 条）。 */
function mount(harness: ManagementHarness): void {
  registerPasskeyEndpoints(harness.deps);
}

/** 发一次请求并返回假响应。 */
async function send(
  harness: ManagementHarness,
  path: string,
  options: {
    method?: string;
    cookie?: string;
    fields?: Record<string, string>;
    contentType?: string;
    origin?: string | null;
  } = {},
): Promise<ReturnType<typeof makeManagementRes>> {
  const res = makeManagementRes();
  await managementHandler(harness.routes, path)(
    managementRequest({
      method: options.method ?? "POST",
      url: path,
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.fields === undefined ? {} : { body: formBody(options.fields) }),
      ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    }),
    res.res,
  );
  return res;
}

/** 造一个已登录的普通用户并返回其 cookie。 */
async function loginAs(
  harness: ManagementHarness,
  username = "alice",
  overrides: Parameters<typeof makeUser>[0] = {},
): Promise<string> {
  harness.users.set(username, makeUser(overrides));
  return harness.issueSessionCookie(username);
}

describe("passkey management: method matrix and transport errors", () => {
  it("answers 405 with allow on every route for the wrong method", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const cases: [string, string, string][] = [
      [PASSKEY_REGISTER_OPTIONS_PATH, "GET", "POST"],
      [PASSKEY_REGISTER_PATH, "GET", "POST"],
      [PASSKEY_PATH, "POST", "GET"],
      [PASSKEY_REMOVE_PATH, "GET", "POST"],
      [PASSKEY_SETTINGS_PATH, "DELETE", "GET, POST"],
    ];
    for (const [path, method, allow] of cases) {
      const res = await send(harness, path, { method });
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe(allow);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("answers 415 for a non-urlencoded body and 413 for an oversized one", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const cookie = await loginAs(harness);
    const wrongType = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie,
      contentType: "application/json",
    });
    expect(wrongType.status).toBe(415);
    const res = makeManagementRes();
    await managementHandler(harness.routes, PASSKEY_REGISTER_OPTIONS_PATH)(
      managementRequest({
        url: PASSKEY_REGISTER_OPTIONS_PATH,
        cookie,
        body: Buffer.alloc(16 * 1024 + 1, 0x61),
      }),
      res.res,
    );
    expect(res.status).toBe(413);
    expect(res.headers["connection"]).toBe("close");
  });

  it("rejects a cross-origin request with 403 before touching the session", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const cookie = await loginAs(harness);
    const res = await send(harness, PASSKEY_REGISTER_OPTIONS_PATH, {
      cookie,
      origin: "https://evil.example",
      fields: { label: "Key", password: TEST_PASSWORD },
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
  });
});

describe("passkey management: session gate", () => {
  it("answers 401 without a session cookie and 503 when the store is unavailable", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    expect((await send(harness, PASSKEY_PATH, { method: "GET" })).status).toBe(401);
    const cookie = await loginAs(harness);
    const deps = harness.deps as { sessions: () => undefined };
    const original = deps.sessions;
    deps.sessions = () => undefined;
    try {
      const res = await send(harness, PASSKEY_PATH, { method: "GET", cookie });
      expect(res.status).toBe(503);
      expect(res.body).toBe("user store unavailable");
    } finally {
      deps.sessions = original;
    }
  });

  it("answers 403 for restricted and bootstrap sessions", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    for (const kind of ["password-change-only", "bootstrap"] as const) {
      const cookie = await harness.issueSessionCookie("alice", kind);
      const res = await send(harness, PASSKEY_PATH, { method: "GET", cookie });
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
    }
  });

  it("answers 401 when the session subject is gone or disabled", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const cookie = await harness.issueSessionCookie("ghost");
    expect((await send(harness, PASSKEY_PATH, { method: "GET", cookie })).status).toBe(401);
    harness.users.set("ghost", makeUser({ disabled: true }));
    expect((await send(harness, PASSKEY_PATH, { method: "GET", cookie })).status).toBe(401);
  });

  it("answers 503 when the users file cannot be read", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const cookie = await loginAs(harness);
    harness.setUsersLoadFailure(true);
    const res = await send(harness, PASSKEY_PATH, { method: "GET", cookie });
    expect(res.status).toBe(503);
    expect(res.body).toBe("user store unavailable");
  });

  it("answers 429 with retry-after when the limiter bucket is locked", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const cookie = await loginAs(harness);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      harness.limiter.recordFailure("203.0.113.9", "alice");
    }
    const res = await send(harness, PASSKEY_REMOVE_PATH, {
      cookie,
      fields: { id: "abcdefgh", password: TEST_PASSWORD },
    });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
    expect(JSON.parse(res.body)).toEqual({ error: "locked" });
  });
});

describe("passkey management: list", () => {
  it("returns summaries sorted by createdAt without key material", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const older = makePasskeyRecord({ createdAt: 10, label: "Old", be: true, bs: true });
    const newer = makePasskeyRecord({ createdAt: 20, label: "New", transports: ["usb"] });
    harness.users.set("alice", makeUser({ passkeys: [newer, older] }));
    const cookie = await harness.issueSessionCookie("alice");
    const res = await send(harness, PASSKEY_PATH, { method: "GET", cookie });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { passkeys: Record<string, unknown>[] };
    expect(body.passkeys.map((row) => row["label"])).toEqual(["Old", "New"]);
    expect(body.passkeys[0]).toEqual({
      idPrefix: older.credentialId.slice(0, 12),
      label: "Old",
      createdAt: 10,
      lastUsedAt: 0,
      backupEligible: true,
      backupState: true,
      transports: ["internal"],
    });
    expect(res.body).not.toContain(older.publicKeyCose);
    expect(res.body).not.toContain("passkeyUserHandle");
  });

  it("returns an empty list for a user without passkeys", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    const cookie = await loginAs(harness);
    const res = await send(harness, PASSKEY_PATH, { method: "GET", cookie });
    expect(JSON.parse(res.body)).toEqual({ passkeys: [] });
  });
});
