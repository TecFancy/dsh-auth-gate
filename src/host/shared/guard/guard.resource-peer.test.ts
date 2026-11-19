/**
 * 带 `peer` 的 resource 读：`webServer.readResource(request, peer)` 的契约是
 * 「调用方已经放行读者」。守卫必须原样放行，不能再按浏览器认证一次：进程内的读
 * 不带 cookie，按匿名判只会得到 401，LiveShare 的 owner 读 viewer 页面正是这样。
 *
 * 浏览器路径（没有 `peer`）必须保持原样，所以这里也固定住「无 peer 仍被拒」。
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
  it("passes a peer-carrying read through without asking the gate", async () => {
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
    const request = makeRequest("/");
    const peer = { id: "peer-liveshare" };
    const result = await guarded(request, peer);
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("index");
    expect(seen.request).toBe(request);
    expect(seen.peer).toBe(peer);
    expect(gateCalls).toBe(0);
  });

  it("does not count a peer-carrying read as an admit or run browser-only checks", async () => {
    let admits = 0;
    const guarded = guardResource(
      () => allow,
      "fallback",
      okResource(),
      () => {
        admits += 1;
      },
    );
    const result = await guarded(
      makeRequest("/api/host.pickDirectory", {
        headers: {
          "x-dsh-proxy": "1",
          "sec-fetch-site": "cross-site",
          "sec-fetch-dest": "document",
        },
      }),
      { id: "peer-liveshare" },
    );
    expect(result.status).toBe(200);
    expect(admits).toBe(0);
  });

  it("keeps the browser path unchanged when no peer is passed", async () => {
    const result = await guardResource(() => deny, "fallback", okResource())(makeRequest("/"));
    expect(result.status).toBe(401);
  });
});
