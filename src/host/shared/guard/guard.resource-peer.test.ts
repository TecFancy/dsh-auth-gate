/**
 * 带 `peer` 的 resource 读：`webServer.readResource(request, peer)` 的契约是
 * 「调用方已经放行读者」。守卫必须原样放行，不能再按浏览器认证一次：进程内的读
 * 不带请求头、没有 cookie，按匿名判只会得到 401，LiveShare 的 owner 读 viewer 页面正是这样。
 *
 * 浏览器路径必须保持原样：0.2.3-alpha.2 起 required 的 resource 路由在网络分发时也把
 * admission.peer 交给 resource，所以「带 peer」不再等于进程内读；带请求头就按浏览器判。
 */
import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import type { ResourceHandler } from "./guard.js";
import { guardResource } from "./resource.js";

const allow: Gate = { decide: () => "allow" };
const deny: Gate = { decide: () => "deny" };

function makeRequest(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Request {
  const requestInit: RequestInit = { method: init.method ?? "GET" };
  if (init.headers !== undefined) requestInit.headers = init.headers;
  return new Request(`http://127.0.0.1:3080${path}`, requestInit);
}

function okResource(body = "ok"): ResourceHandler {
  return () =>
    Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/plain" } }));
}

describe("guardResource: in-process reads carrying a peer", () => {
  it("passes a header-less peer-carrying read through without asking the gate", async () => {
    let gateCalls = 0;
    const gate: Gate = {
      decide: () => {
        gateCalls += 1;
        return "deny";
      },
    };
    const seen: { request?: Request; peer?: unknown } = {};
    const resource: ResourceHandler = async (request, peer) => {
      seen.request = request;
      seen.peer = peer;
      return await Promise.resolve(new Response("index", { status: 200 }));
    };
    const guarded = guardResource(() => gate, "fallback", resource);
    const request = new Request("http://127.0.0.1:3080/");
    const peer = { id: "peer-liveshare" };
    const result = await guarded(request, peer);
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("index");
    expect(seen.request).toBe(request);
    expect(seen.peer).toBe(peer);
    expect(gateCalls).toBe(0);
  });

  it("does not count a header-less peer-carrying read as an admit or run browser-only checks", async () => {
    let admits = 0;
    const guarded = guardResource(
      () => allow,
      "fallback",
      okResource(),
      () => {
        admits += 1;
      },
    );
    const result = await guarded(new Request("http://127.0.0.1:3080/api/host.pickDirectory"), {
      id: "peer-liveshare",
    });
    expect(result.status).toBe(200);
    expect(admits).toBe(0);
  });

  it("treats a peer-carrying request WITH headers as a browser request (0.2.3 network path)", async () => {
    let gateCalls = 0;
    const guarded = guardResource(
      () => ({
        decide: () => {
          gateCalls += 1;
          return "deny";
        },
      }),
      "fallback",
      okResource(),
    );
    // required 的 resource 路由在网络分发时也带 peer；有请求头就必须走门，不能当进程内读放行。
    const result = await guarded(
      makeRequest("/", { headers: { host: "127.0.0.1:3080", "sec-fetch-dest": "document" } }),
      { id: "peer-network" },
    );
    expect(result.status).toBe(302);
    expect(gateCalls).toBe(1);
  });

  it("keeps the browser path unchanged when no peer is passed", async () => {
    const result = await guardResource(() => deny, "fallback", okResource())(makeRequest("/"));
    expect(result.status).toBe(401);
  });
});
