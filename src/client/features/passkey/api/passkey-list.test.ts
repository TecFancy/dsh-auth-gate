/**
 * passkey 管理面 API（M6 PR3）：列表解析、注册/删除/设置的请求形状与失败映射。
 *
 * 只 mock `fetch` 与 `navigator.credentials.create`；断言的是「发出去的请求」与
 * 「解析回来的视图」，不碰 React。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPasskeys } from "./passkey-list.ts";

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

function lastRequest(): [string, RequestInit | undefined] {
  const call = requests[requests.length - 1];
  if (call === undefined) throw new Error("no request recorded");
  return call;
}

const SUMMARY = {
  idPrefix: "abcdefghijkl",
  label: "MacBook",
  createdAt: 1_700_000_000_000,
  lastUsedAt: 0,
  backupEligible: true,
  backupState: false,
  transports: ["internal"],
};

describe("fetchPasskeys", () => {
  it("GETs the list with same-origin credentials and parses every field", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(jsonResponse(200, { passkeys: [SUMMARY] }));
    });
    const result = await fetchPasskeys(new AbortController().signal);
    const [url, init] = lastRequest();
    expect(url).toBe("/auth/passkey");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(result).toEqual({ kind: "ok", passkeys: [SUMMARY] });
  });

  it("drops rows with a wrong field type but keeps the rest", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(200, {
          passkeys: [SUMMARY, { ...SUMMARY, idPrefix: 42 }, { ...SUMMARY, transports: "usb" }],
        }),
      ),
    );
    const result = await fetchPasskeys(new AbortController().signal);
    expect(result).toEqual({ kind: "ok", passkeys: [SUMMARY] });
  });

  it("treats a non-array passkeys field as a shape failure", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { passkeys: {} })));
    expect(await fetchPasskeys(new AbortController().signal)).toEqual({ kind: "failure" });
  });

  it("maps 401 to unauthorized and 403 to forbidden", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(401, {})));
    expect(await fetchPasskeys(new AbortController().signal)).toEqual({ kind: "unauthorized" });
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, {})));
    expect(await fetchPasskeys(new AbortController().signal)).toEqual({ kind: "forbidden" });
  });

  it("maps 503 and network errors to failure", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(503, {})));
    expect(await fetchPasskeys(new AbortController().signal)).toEqual({ kind: "failure" });
    fetchMock.mockImplementation(() => Promise.reject(new Error("network")));
    expect(await fetchPasskeys(new AbortController().signal)).toEqual({ kind: "failure" });
  });
});
