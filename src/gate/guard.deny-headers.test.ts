/**
 * deny 出口的响应头（2026-10-06，grok 实现期评审 B3）：被拒的请求 URL 可能自带 dsh 的
 * launch token（`/?token=`），两条跳登录页的 302 都必须带 `referrer-policy: no-referrer`，
 * 否则浏览器会把带 token 的完整 URL 作为 Referer 送进登录页请求。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { denyHttp } from "./guard.js";

interface ResState {
  status: number | undefined;
  headers: Record<string, string> | undefined;
}

type FakeRes = ServerResponse & { state: ResState };

function makeReq(url: string, extra: Record<string, string>): IncomingMessage {
  return { url, method: "GET", headers: { ...extra } } as unknown as IncomingMessage;
}

function makeRes(): FakeRes {
  const state: ResState = { status: undefined, headers: undefined };
  return {
    state,
    headersSent: false,
    setHeader(name: string, value: string) {
      state.headers = { ...state.headers, [name]: value };
    },
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status;
      state.headers = { ...state.headers, ...headers };
    },
    end() {
      // 302 无 body。
    },
  } as unknown as FakeRes;
}

describe("denyHttp: the login redirect never hands the launch token to the Referer", () => {
  it("sets no-referrer on the navigation denial (plain string decision)", () => {
    const res = makeRes();
    denyHttp(makeReq("/?token=abc123", { "sec-fetch-mode": "navigate" }), res);
    expect(res.state.status).toBe(302);
    expect(res.state.headers!["location"]).toBe("/auth/login?next=%2F");
    expect(res.state.headers!["cache-control"]).toBe("no-store");
    expect(res.state.headers!["referrer-policy"]).toBe("no-referrer");
  });

  it("sets no-referrer on a gate-provided redirect decision", () => {
    const res = makeRes();
    denyHttp(makeReq("/some/path", { "sec-fetch-dest": "document" }), res, {
      deny: { redirect: "/auth/login?next=%2Fsome%2Fpath" },
    });
    expect(res.state.status).toBe(302);
    expect(res.state.headers!["location"]).toBe("/auth/login?next=%2Fsome%2Fpath");
    expect(res.state.headers!["referrer-policy"]).toBe("no-referrer");
  });

  it("leaves the 401 path without a redirect policy", () => {
    const res = makeRes();
    denyHttp(makeReq("/api/x", { accept: "application/json" }), res);
    expect(res.state.status).toBe(401);
    expect(res.state.headers!["referrer-policy"]).toBeUndefined();
  });
});
