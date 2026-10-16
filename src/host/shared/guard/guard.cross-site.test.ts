/**
 * 跨站顶层导航弹回：gate 已放行但请求来自跨站文档导航时，守卫不进原 handler，
 * 改回同源弹回页（外层 Lax cookie 与 dsh 内层 Strict cookie 的差异，见 `serveCrossSiteBounce`）。
 */
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { isCrossSiteDocumentNavigation } from "./cross-site-bounce.js";
import type { Gate } from "./gate.js";
import { guardHttp } from "./guard.js";

interface ResState {
  status: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}
type FakeRes = ServerResponse & { state: ResState };

function makeReq(url: string, headers: Record<string, string>, method = "GET"): IncomingMessage {
  return { url, method, headers: { ...headers } } as unknown as IncomingMessage;
}

function makeRes(): FakeRes {
  const state: ResState = { status: undefined, headers: undefined, body: undefined };
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
    end(body?: string) {
      state.body = body;
    },
  } as unknown as FakeRes;
}

const CROSS = { "sec-fetch-site": "cross-site", "sec-fetch-dest": "document" };
const allow: Gate = { decide: () => "allow" };

async function run(gate: Gate, req: IncomingMessage): Promise<{ res: FakeRes; calls: number }> {
  let calls = 0;
  const handler = guardHttp(
    () => gate,
    "exact",
    () => {
      calls += 1;
    },
  );
  const res = makeRes();
  await handler(req, res);
  return { res, calls };
}

describe("isCrossSiteDocumentNavigation", () => {
  it("is true for GET + cross-site + document, case-insensitively", () => {
    expect(isCrossSiteDocumentNavigation(makeReq("/", CROSS))).toBe(true);
    expect(
      isCrossSiteDocumentNavigation(
        makeReq("/", { "sec-fetch-site": "Cross-Site", "sec-fetch-dest": "DOCUMENT" }),
      ),
    ).toBe(true);
  });

  it.each([
    ["same-origin", { "sec-fetch-site": "same-origin", "sec-fetch-dest": "document" }],
    ["same-site", { "sec-fetch-site": "same-site", "sec-fetch-dest": "document" }],
    ["none", { "sec-fetch-site": "none", "sec-fetch-dest": "document" }],
    ["dest=iframe", { "sec-fetch-site": "cross-site", "sec-fetch-dest": "iframe" }],
    ["dest=empty", { "sec-fetch-site": "cross-site", "sec-fetch-dest": "empty" }],
    ["dest missing", { "sec-fetch-site": "cross-site" }],
    ["site missing", { "sec-fetch-dest": "document" }],
    ["both missing", {}],
  ])("is false for %s", (_label, headers) => {
    expect(isCrossSiteDocumentNavigation(makeReq("/", headers))).toBe(false);
  });

  it("is false for HEAD and POST", () => {
    expect(isCrossSiteDocumentNavigation(makeReq("/", CROSS, "HEAD"))).toBe(false);
    expect(isCrossSiteDocumentNavigation(makeReq("/", CROSS, "POST"))).toBe(false);
  });
});

describe("guardHttp: cross-site document navigation bounce", () => {
  it("serves the bounce page instead of the original handler", async () => {
    const { res, calls } = await run(allow, makeReq("/?token=xyz-secret", CROSS));
    expect(calls).toBe(0);
    expect(res.state.status).toBe(200);
    const h = res.state.headers!;
    expect(h["content-type"]).toBe("text/html; charset=utf-8");
    expect(h["cache-control"]).toBe("no-store");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["x-content-type-options"]).toBe("nosniff");
    const body = res.state.body!;
    expect(body).toContain('<noscript><a href="">Continue</a></noscript>');
    // CSP 哈希必须等于页面里实际内联脚本的哈希。
    const script = /<script>([^<]*)<\/script>/.exec(body)![1]!;
    expect(script).toBe("location.replace(location.href)");
    const hash = createHash("sha256").update(script).digest("base64");
    expect(h["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    // 不反射请求数据。
    expect(body).not.toContain("xyz-secret");
    expect(body).not.toContain("token");
  });

  it.each([
    ["same-origin", { "sec-fetch-site": "same-origin", "sec-fetch-dest": "document" }, "GET"],
    ["same-site", { "sec-fetch-site": "same-site", "sec-fetch-dest": "document" }, "GET"],
    ["none", { "sec-fetch-site": "none", "sec-fetch-dest": "document" }, "GET"],
    ["missing headers", {}, "GET"],
    ["dest=iframe", { "sec-fetch-site": "cross-site", "sec-fetch-dest": "iframe" }, "GET"],
    ["dest=empty", { "sec-fetch-site": "cross-site", "sec-fetch-dest": "empty" }, "GET"],
    ["HEAD", CROSS, "HEAD"],
    ["POST", CROSS, "POST"],
  ])("calls the original handler for %s", async (_label, headers, method) => {
    const { res, calls } = await run(allow, makeReq("/", headers, method));
    expect(calls).toBe(1);
    expect(res.state.status).toBeUndefined();
  });

  it("keeps the login redirect when the gate denies a cross-site navigation", async () => {
    const deny: Gate = { decide: () => ({ deny: { redirect: "/auth/login?next=%2F" } }) };
    const { res, calls } = await run(deny, makeReq("/?token=abc", CROSS));
    expect(calls).toBe(0);
    expect(res.state.status).toBe(302);
    expect(res.state.headers!["location"]).toBe("/auth/login?next=%2F");
  });

  it("keeps the legacy string deny as a 302 to login", async () => {
    const deny: Gate = { decide: () => "deny" };
    const { res } = await run(deny, makeReq("/x", { ...CROSS, "sec-fetch-mode": "navigate" }));
    expect(res.state.status).toBe(302);
    expect(res.state.headers!["location"]).toBe("/auth/login?next=%2Fx");
  });

  it("still answers 403 for a proxy-denied method even when cross-site", async () => {
    const { res, calls } = await run(
      allow,
      makeReq("/api/host.openPath", { ...CROSS, "x-dsh-proxy": "1" }),
    );
    expect(calls).toBe(0);
    expect(res.state.status).toBe(403);
  });
});
