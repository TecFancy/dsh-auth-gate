/**
 * 条件 UI 设置（M6 PR3）：GET 解析、POST 的 `conditionalUi=1/0`、403/404 静默。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPasskeySettings, updatePasskeySettings } from "./passkey-settings.ts";

const fetchMock = vi.fn();
const requests: [string, RequestInit | undefined][] = [];

beforeEach(() => {
  requests.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

function bodyOf(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;
  return body instanceof URLSearchParams ? body : new URLSearchParams();
}

describe("passkey settings", () => {
  it("GETs the current value and parses conditionalUiEnabled", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(jsonResponse(200, { conditionalUiEnabled: true }));
    });
    expect(await fetchPasskeySettings(new AbortController().signal)).toEqual({
      kind: "ok",
      conditionalUiEnabled: true,
    });
    expect(lastRequest()[0]).toBe("/auth/passkey/settings");
  });

  it("maps 403 to forbidden (non-admin) and a bad body to failure", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, {})));
    expect(await fetchPasskeySettings(new AbortController().signal)).toEqual({
      kind: "forbidden",
    });
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { nope: 1 })));
    expect(await fetchPasskeySettings(new AbortController().signal)).toEqual({ kind: "failure" });
  });

  it("POSTs conditionalUi as 1/0 and returns the server value", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(jsonResponse(200, { conditionalUiEnabled: false }));
    });
    expect(await updatePasskeySettings(false, new AbortController().signal)).toEqual({
      kind: "ok",
      conditionalUiEnabled: false,
    });
    const [url, init] = lastRequest();
    expect(url).toBe("/auth/passkey/settings");
    expect(init?.method).toBe("POST");
    expect(bodyOf(init).toString()).toBe("conditionalUi=0");
  });
});
