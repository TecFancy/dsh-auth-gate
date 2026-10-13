import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { authCatchAll, methodNotAllowed, queryOf } from "./index.js";

/**
 * http/ 纯 HTTP 端点件的单元测试（经 barrel 取被测物）：兜底 404、405、query 解析。
 * 这些件与会话无关，D29 后归 `shared/http`；logout 与 `/auth/status` 在
 * `session-endpoints.test.ts` 与 `session-endpoints.status.test.ts`。
 */

interface FakeRes {
  res: ServerResponse;
  status: number | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

/** 与真实 ServerResponse 一样：writeHead 之后再 setHeader / writeHead 会抛错。 */
function makeRes(): FakeRes {
  const state: Omit<FakeRes, "res"> = { status: undefined, headers: {}, body: undefined };
  let sent = false;
  const res = {
    setHeader: (name: string, value: string): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: setHeader after writeHead");
      state.headers[name.toLowerCase()] = String(value);
    },
    writeHead: (status: number, extra?: Record<string, string>): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: writeHead called twice");
      sent = true;
      state.status = status;
      for (const [name, value] of Object.entries(extra ?? {})) {
        state.headers[name.toLowerCase()] = value;
      }
    },
    end: (chunk?: string): void => {
      state.body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return Object.assign(state, { res });
}

function makeReq(method: string | undefined, url?: string, cookie?: string): IncomingMessage {
  return {
    method,
    url,
    headers: cookie === undefined ? {} : { cookie },
  } as unknown as IncomingMessage;
}

describe("authCatchAll", () => {
  it("answers 404 text with no-store for any method", () => {
    for (const method of ["GET", "POST", undefined]) {
      const res = makeRes();
      authCatchAll(makeReq(method, "/auth/unknown"), res.res);
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toBe("not found");
    }
  });
});

describe("methodNotAllowed", () => {
  it("answers 405 with the Allow header it was given", () => {
    const res = makeRes();
    methodNotAllowed(res.res, "POST");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.headers["content-type"]).toBe("text/plain");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe("method not allowed");
  });
});

describe("queryOf", () => {
  it("parses the query string of a path-only url", () => {
    const query = queryOf(makeReq("GET", "/auth/logout?next=%2Fchat&x=1"));
    expect(query.get("next")).toBe("/chat");
    expect(query.get("x")).toBe("1");
  });

  it("returns an empty query when the url is missing or has none", () => {
    expect([...queryOf(makeReq("GET", undefined))]).toEqual([]);
    expect([...queryOf(makeReq("GET", "/auth/logout"))]).toEqual([]);
  });

  it("does not throw on a protocol-relative url", () => {
    const query = queryOf(makeReq("GET", "//evil.example/?next=/a"));
    expect(query.get("next")).toBe("/a");
  });
});
