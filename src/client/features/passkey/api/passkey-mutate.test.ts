/**
 * passkey 注册与删除（M6 PR3）：请求形状、再认证字段、失败映射与用户取消。
 *
 * 只 mock `fetch` 与 `navigator.credentials.create`；断言的是「发出去的请求」。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSKEY_DICT_EN, translateFrom } from "../../../shared/i18n/index.ts";
import { registerPasskey } from "./passkey-mutate.ts";

const t = translateFrom(PASSKEY_DICT_EN);
const fetchMock = vi.fn();
const requests: [string, RequestInit | undefined][] = [];

beforeEach(() => {
  requests.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    requests.push([url, init]);
    return Promise.resolve(jsonResponse(200, {}));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis.navigator, "credentials");
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function bodyOf(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;
  return body instanceof URLSearchParams ? body : new URLSearchParams();
}

const OPTIONS = {
  challenge: "AQID",
  rp: { id: "dsh.example.com", name: "DeepSeek Harness" },
  user: { id: "BAUG", name: "alice", displayName: "Alice" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};

describe("registerPasskey", () => {
  const VALUES = { label: " MacBook ", password: "pw", code: "123456" };

  /** 让 `navigator.credentials.create` 返回一个最小可用的 attestation 结果。 */
  function stubCreate(): void {
    vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
    Object.defineProperty(globalThis.navigator, "credentials", {
      configurable: true,
      value: {
        create: () =>
          Promise.resolve({
            id: "cred-id",
            rawId: new Uint8Array([1, 2, 3]).buffer,
            response: {
              clientDataJSON: new Uint8Array([4, 5]).buffer,
              attestationObject: new Uint8Array([6, 7]).buffer,
              getTransports: () => ["internal", "hybrid"],
            },
          }),
      },
    });
  }

  it("posts re-auth fields to register/options, then the attestation to register", async () => {
    stubCreate();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(
        url === "/auth/passkey/register/options"
          ? jsonResponse(200, OPTIONS)
          : jsonResponse(200, {}),
      );
    });
    const result = await registerPasskey(VALUES, new AbortController().signal, t);
    expect(result).toEqual({ kind: "ok" });
    const [optionsUrl, optionsInit] = requests[0]!;
    expect(optionsUrl).toBe("/auth/passkey/register/options");
    expect(optionsInit?.method).toBe("POST");
    expect(optionsInit?.credentials).toBe("same-origin");
    expect(bodyOf(optionsInit).toString()).toBe("label=MacBook&password=pw&code=123456");
    const [registerUrl, registerInit] = requests[1]!;
    expect(registerUrl).toBe("/auth/passkey/register");
    const body = bodyOf(registerInit);
    expect(body.get("label")).toBe("MacBook");
    expect(body.get("password")).toBe("pw");
    expect(body.get("code")).toBe("123456");
    expect(body.get("id")).toBe("cred-id");
    expect(body.get("client_data_json")).toBe("BAU");
    expect(body.get("attestation_object")).toBe("Bgc");
    expect(body.get("transports")).toBe("internal,hybrid");
  });
});

describe("registerPasskey: 失败与取消", () => {
  const VALUES = { label: "MacBook", password: "pw", code: "" };

  /** 让 `navigator.credentials.create` 返回一个最小可用的 attestation 结果。 */
  function stubCreate(): void {
    vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
    Object.defineProperty(globalThis.navigator, "credentials", {
      configurable: true,
      value: {
        create: () =>
          Promise.resolve({
            id: "cred-id",
            rawId: new Uint8Array([1, 2, 3]).buffer,
            response: {
              clientDataJSON: new Uint8Array([4, 5]).buffer,
              attestationObject: new Uint8Array([6, 7]).buffer,
              getTransports: () => ["internal"],
            },
          }),
      },
    });
  }

  it("returns unsupported when the browser has no WebAuthn", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(await registerPasskey(VALUES, new AbortController().signal, t)).toEqual({
      kind: "unsupported",
    });
    expect(requests).toHaveLength(0);
  });

  it("maps a 401 invalid_totp from register/options to the code field", async () => {
    stubCreate();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(jsonResponse(401, { error: "invalid_totp" }));
    });
    const result = await registerPasskey(VALUES, new AbortController().signal, t);
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.fields).toEqual(["code"]);
    expect(requests).toHaveLength(1);
  });

  it("maps a wrong password (401 without a code) to the password field", async () => {
    stubCreate();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(401, {})));
    const result = await registerPasskey(VALUES, new AbortController().signal, t);
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.fields).toEqual(["password"]);
  });

  it("treats a user cancellation (NotAllowedError) as aborted, not as an error", async () => {
    vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
    Object.defineProperty(globalThis.navigator, "credentials", {
      configurable: true,
      value: {
        create: () =>
          Promise.reject(Object.assign(new Error("cancelled"), { name: "NotAllowedError" })),
      },
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(jsonResponse(200, OPTIONS));
    });
    expect(await registerPasskey(VALUES, new AbortController().signal, t)).toEqual({
      kind: "aborted",
    });
  });

  it("fails when the options body is not creation options", async () => {
    stubCreate();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { nope: true })));
    const result = await registerPasskey(VALUES, new AbortController().signal, t);
    expect(result.kind).toBe("failure");
  });
});
