import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH } from "./account-copy.ts";
import { fetchAdminUsers, submitAdminReset } from "./admin-api.ts";
import { ADMIN_DICT_ZH, ADMIN_KEYS, translateAdminFrom } from "./admin-copy.ts";
import type { AdminResetResult, AdminResetValues } from "./admin-types.ts";

/** 宿主把 account / admin 分片合并成一个 `auth` 命名域（见 index.tsx），测试按同一合并构造 `t`。 */
const zh = translateAdminFrom({ ...ACCOUNT_DICT_ZH, ...ADMIN_DICT_ZH });

/** 合法表单值（confirm 与 password 一致；confirm 永不进请求体）。 */
const VALUES: AdminResetValues = {
  target: "bob",
  password: "NewPassw0rdXZ12",
  confirm: "NewPassw0rdXZ12",
  code: "123456",
};

/** 未列出的 status/body 组合一律走兜底文案（§9/A10）。 */
const GENERIC_FAILURE: AdminResetResult = {
  kind: "failure",
  failure: { message: zh(ADMIN_KEYS.generic), rules: [], fields: [] },
};

type Call = [string, RequestInit];

const calls: Call[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function jsonResponse(status: number, body: unknown): unknown {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

/** 契约里的 text/plain 状态码：解析必然失败。 */
function textResponse(status: number): unknown {
  return { ok: false, status, json: () => Promise.reject(new Error("not json")) };
}

function badJsonOk(): unknown {
  return { ok: true, status: 200, json: () => Promise.reject(new Error("not json")) };
}

function row(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    role: "user",
    disabled: false,
    totpEnabled: false,
    mustChangePassword: false,
    ...overrides,
  };
}

/** A11：断言请求路径**集合**，不断言调用次数。 */
function pathsOf(captured: Call[]): string[] {
  return [...new Set(captured.map(([url]) => url))].sort((a, b) => a.localeCompare(b));
}

/** fetch mock：记录每次调用并按给定响应作答。 */
function record(response: unknown): (input: unknown, init?: RequestInit) => Promise<unknown> {
  return (input, init) => {
    calls.push([String(input), init ?? {}]);
    return Promise.resolve(response);
  };
}

function submitOptions(actorTotpEnabled = false): {
  signal: AbortSignal;
  actorTotpEnabled: boolean;
} {
  return { signal: new AbortController().signal, actorTotpEnabled };
}

describe("fetchAdminUsers: payload", () => {
  it("keeps the server order and drops rows whose shape is invalid", async () => {
    const signal = new AbortController().signal;
    fetchMock.mockImplementation(
      record(
        jsonResponse(200, {
          users: [
            row("zeta", { role: "admin", disabled: true }),
            { name: "broken" },
            row("alpha", { mustChangePassword: true, totpEnabled: true }),
            "junk",
            row("no-bools", { disabled: "yes" }),
          ],
        }),
      ),
    );
    const result = await fetchAdminUsers(signal);
    expect(result).toMatchObject({ kind: "ok" });
    const users = result.kind === "ok" ? result.users : [];
    expect(users.map((user) => user.name)).toEqual(["zeta", "alpha"]);
    expect(users[0]).toEqual({
      name: "zeta",
      role: "admin",
      disabled: true,
      totpEnabled: false,
      mustChangePassword: false,
    });
    expect(users[1]).toEqual({
      name: "alpha",
      role: "user",
      disabled: false,
      totpEnabled: true,
      mustChangePassword: true,
    });
  });

  it("requests /auth/users with cookie credentials and no extra header", async () => {
    const signal = new AbortController().signal;
    fetchMock.mockImplementation(record(jsonResponse(200, { users: [] })));
    await fetchAdminUsers(signal);
    const [, init] = calls[0]!;
    expect(pathsOf(calls)).toEqual(["/auth/users"]);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.signal).toBe(signal);
    expect(init.headers).toBeUndefined(); // 列表 GET 不带任何头（更不手写 Origin）
  });

  it("treats an unusable payload as failure", async () => {
    for (const body of [{}, { users: "nope" }, null, []]) {
      fetchMock.mockResolvedValue(jsonResponse(200, body));
      expect(await fetchAdminUsers(new AbortController().signal)).toEqual({ kind: "failure" });
    }
  });

  it("treats invalid JSON as failure", async () => {
    fetchMock.mockResolvedValue(badJsonOk());
    expect(await fetchAdminUsers(new AbortController().signal)).toEqual({ kind: "failure" });
  });
});

describe("fetchAdminUsers: status and abort", () => {
  it("maps 403 to denied (silent) and 401 to unauthorized (§9/A2)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    expect(await fetchAdminUsers(new AbortController().signal)).toEqual({ kind: "denied" });
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    expect(await fetchAdminUsers(new AbortController().signal)).toEqual({ kind: "unauthorized" });
  });

  it("maps 503 and a network error to failure", async () => {
    fetchMock.mockResolvedValue(textResponse(503));
    expect(await fetchAdminUsers(new AbortController().signal)).toEqual({ kind: "failure" });
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await fetchAdminUsers(new AbortController().signal)).toEqual({ kind: "failure" });
  });

  it("aborts without parsing the response body", async () => {
    const controller = new AbortController();
    const json = vi.fn(() => Promise.resolve({ users: [] }));
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ ok: true, status: 200, json });
    });
    expect(await fetchAdminUsers(controller.signal)).toEqual({ kind: "aborted" });
    expect(json).not.toHaveBeenCalled();
  });

  it("reports aborted when the in-flight fetch rejects on abort", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    expect(await fetchAdminUsers(controller.signal)).toEqual({ kind: "aborted" });
  });
});

describe("submitAdminReset: request shaping", () => {
  it("omits code when the actor has no TOTP and never sends confirm", async () => {
    fetchMock.mockImplementation(record(jsonResponse(200, { ok: true, sessionsRevoked: true })));
    const result = await submitAdminReset(VALUES, submitOptions(), zh);
    expect(result).toEqual({ kind: "ok", sessionsRevoked: true });
    expect(pathsOf(calls)).toEqual(["/auth/users/password"]);
    const [url, init] = calls[0]!;
    expect(url).toBe("/auth/users/password");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(init.headers).not.toHaveProperty("origin");
    expect(init.credentials).toBe("same-origin");
    const body = init.body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.toString()).toBe("target=bob&password=NewPassw0rdXZ12");
    expect(body.toString()).not.toContain("confirm");
    expect(body.has("code")).toBe(false);
  });

  it("sends code for a TOTP-enabled actor, empty value included", async () => {
    const bodies: string[] = [];
    fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => {
      bodies.push((init?.body as URLSearchParams).toString());
      return Promise.resolve(jsonResponse(200, { ok: true, sessionsRevoked: true }));
    });
    await submitAdminReset(VALUES, submitOptions(true), zh);
    await submitAdminReset({ ...VALUES, code: "" }, submitOptions(true), zh);
    expect(bodies).toEqual([
      "target=bob&password=NewPassw0rdXZ12&code=123456",
      "target=bob&password=NewPassw0rdXZ12&code=",
    ]);
  });
});

describe("submitAdminReset: results and failures", () => {
  it("only a literal 200 {ok:true} is success; sessionsRevoked only when literally true (§9/A10)", async () => {
    const cases: [unknown, AdminResetResult][] = [
      [
        jsonResponse(200, { ok: true, sessionsRevoked: true }),
        { kind: "ok", sessionsRevoked: true },
      ],
      [
        jsonResponse(200, { ok: true, sessionsRevoked: "yes" }),
        { kind: "ok", sessionsRevoked: false },
      ],
      [jsonResponse(200, { ok: true }), { kind: "ok", sessionsRevoked: false }],
      // 2xx 但形状不对（网关 HTML / 空 JSON / ok:false / 非法 ok）一律报失败，绝不谎报已重置。
      [jsonResponse(200, { ok: "true", sessionsRevoked: true }), GENERIC_FAILURE],
      [badJsonOk(), GENERIC_FAILURE],
      [jsonResponse(200, {}), GENERIC_FAILURE],
      [jsonResponse(200, { ok: false }), GENERIC_FAILURE],
    ];
    for (const [response, expected] of cases) {
      fetchMock.mockResolvedValue(response);
      expect(await submitAdminReset(VALUES, submitOptions(), zh)).toEqual(expected);
    }
  });

  it.each([
    ["400 policy", 400, { error: "policy", rules: ["minLength"] }, ADMIN_KEYS.policyIntro],
    ["401 invalid_totp", 401, { error: "invalid_totp" }, ADMIN_KEYS.invalidTotp],
    ["403 forbidden", 403, { error: "forbidden" }, ADMIN_KEYS.forbidden],
    ["404 not_found", 404, { error: "not_found" }, ADMIN_KEYS.notFound],
    ["429 locked", 429, { error: "locked", retryAfter: 5 }, ADMIN_KEYS.locked],
    ["413 generic", 413, null, ADMIN_KEYS.generic],
    ["503 generic", 503, null, ADMIN_KEYS.generic],
  ])("maps %s to the failure view", async (_label, status, body, key) => {
    fetchMock.mockResolvedValue(
      status === 413 || status === 503 ? textResponse(status) : jsonResponse(status, body),
    );
    const result = await submitAdminReset(VALUES, submitOptions(), zh);
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.failure.message).toBe(zh(key, { seconds: 5 }));
    }
  });

  it("maps a network error to the generic copy", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await submitAdminReset(VALUES, submitOptions(), zh)).toEqual({
      kind: "failure",
      failure: { message: "重置失败，请稍后重试。", rules: [], fields: [] },
    });
  });

  it("aborts without parsing the response body", async () => {
    const controller = new AbortController();
    const json = vi.fn(() => Promise.resolve({ ok: true, sessionsRevoked: true }));
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ ok: true, status: 200, json });
    });
    const options = { signal: controller.signal, actorTotpEnabled: false };
    expect(await submitAdminReset(VALUES, options, zh)).toEqual({ kind: "aborted" });
    expect(json).not.toHaveBeenCalled();
  });
});
