/**
 * passkey 删除（M6 PR3）：请求形状与失败映射。
 *
 * 再认证字段随请求一起发（服务端只在删最后一把或 `all=1` 时校验，普通单删忽略）。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSKEY_DICT_EN, translateFrom } from "../../../shared/i18n/index.ts";
import { removePasskey } from "./passkey-mutate.ts";

const t = translateFrom(PASSKEY_DICT_EN);
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

describe("removePasskey", () => {
  it("posts the id prefix plus re-auth fields", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(jsonResponse(200, {}));
    });
    const result = await removePasskey(
      "abcdefghijkl",
      { label: "", password: "pw", code: "" },
      new AbortController().signal,
      t,
    );
    expect(result).toEqual({ kind: "ok" });
    const [url, init] = lastRequest();
    expect(url).toBe("/auth/passkey/remove");
    expect(bodyOf(init).toString()).toBe("id=abcdefghijkl&password=pw&code=");
  });

  it("maps 404 to not_found and 403 to forbidden", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(404, { error: "not_found" })));
    const missing = await removePasskey(
      "abcdefghijkl",
      { label: "", password: "", code: "" },
      new AbortController().signal,
      t,
    );
    expect(missing.kind).toBe("failure");
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, { error: "forbidden" })));
    const denied = await removePasskey(
      "abcdefghijkl",
      { label: "", password: "", code: "" },
      new AbortController().signal,
      t,
    );
    expect(denied.kind).toBe("failure");
  });
});
