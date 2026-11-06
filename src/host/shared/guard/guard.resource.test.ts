import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import { GUARDED, isGuarded, type GuardRequest, type ResourceHandler } from "./guard.js";
import { guardResource } from "./resource.js";

const allow: Gate = { decide: () => "allow" };
const deny: Gate = { decide: () => "deny" };

function reply(body: string, init: ResponseInit = {}): Promise<Response> {
  return Promise.resolve(new Response(body, init));
}

function makeRequest(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Request {
  const requestInit: RequestInit = { method: init.method ?? "GET" };
  if (init.headers !== undefined) requestInit.headers = init.headers;
  return new Request(`http://127.0.0.1:3080${path}`, requestInit);
}

function okResource(body = "ok"): ResourceHandler {
  return () => reply(body, { status: 200, headers: { "content-type": "text/plain" } });
}

describe("guardResource: decisions and transport", () => {
  it("allows with the original Request and peer and returns the same Response", async () => {
    const seen: { request?: Request; peer?: unknown } = {};
    const response = new Response("passthrough", { status: 200 });
    const resource: ResourceHandler = async (request, peer) => {
      seen.request = request;
      seen.peer = peer;
      return await Promise.resolve(response);
    };
    const guarded = guardResource(() => allow, "prefix", resource);
    const request = makeRequest("/plugins/app/client.js");
    const peer = { id: "peer-1" };
    const result = await guarded(request, peer);
    expect(result).toBe(response);
    expect(seen.request).toBe(request);
    expect(seen.peer).toBe(peer);
  });

  it("redirects navigation denial with 302, next and no-store headers", async () => {
    const guarded = guardResource(() => deny, "fallback", okResource());
    const result = await guarded(
      makeRequest("/deep/link?token=abc", {
        headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
      }),
    );
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("/auth/login?next=%2Fdeep%2Flink");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(result.headers.get("location")).not.toContain("token");
  });

  it("returns 401 unauthorized for non-navigation denial", async () => {
    const guarded = guardResource(() => deny, "prefix", okResource());
    const result = await guarded(makeRequest("/plugins/app/client.js"));
    expect(result.status).toBe(401);
    expect(await result.text()).toBe("unauthorized");
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 403 for an explicit status denial without calling resource", async () => {
    let called = false;
    const resource: ResourceHandler = () => {
      called = true;
      return reply("should not happen");
    };
    const gate: Gate = { decide: () => ({ deny: { status: 403 } }) };
    const result = await guardResource(() => gate, "prefix", resource)(makeRequest("/plugins/x"));
    expect(result.status).toBe(403);
    expect(called).toBe(false);
  });

  it("returns 403 for a proxy-denied resource request before cross-site bounce", async () => {
    const guarded = guardResource(() => allow, "exact", okResource());
    const result = await guarded(
      makeRequest("/api/host.pickDirectory", {
        headers: {
          "x-dsh-proxy": "1",
          "sec-fetch-site": "cross-site",
          "sec-fetch-dest": "document",
        },
      }),
    );
    expect(result.status).toBe(403);
  });

  it("passes allowed HEAD through and keeps denied HEAD responses bodyless", async () => {
    const guarded = guardResource(() => allow, "prefix", okResource());
    const allowed = await guarded(makeRequest("/plugins/a.js", { method: "HEAD" }));
    expect(allowed.status).toBe(200);
    const denied = await guardResource(
      () => deny,
      "prefix",
      okResource(),
    )(makeRequest("/plugins/a.js", { method: "HEAD" }));
    expect(denied.status).toBe(401);
    expect(denied.body).toBeNull();
  });
});

describe("guardResource: response fidelity", () => {
  it("preserves an allowed 206 Range response and its headers", async () => {
    const ranged = new Response("part", {
      status: 206,
      headers: { "content-range": "bytes 0-3/10", "accept-ranges": "bytes" },
    });
    const resource: ResourceHandler = () => Promise.resolve(ranged);
    const result = await guardResource(() => allow, "fallback", resource)(makeRequest("/video"));
    expect(result).toBe(ranged);
    expect(result.status).toBe(206);
    expect(result.headers.get("content-range")).toBe("bytes 0-3/10");
  });

  it("does not buffer or transform gzip and ReadableStream response bodies", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("gz"));
        controller.close();
      },
    });
    const encoded = new Response(stream, {
      status: 200,
      headers: { "content-encoding": "gzip", "content-type": "application/javascript" },
    });
    const result = await guardResource(
      () => allow,
      "prefix",
      () => Promise.resolve(encoded),
    )(makeRequest("/plugins/a.js"));
    expect(result).toBe(encoded);
    expect(await result.text()).toBe("gz");
  });

  it("serves the shared cross-site bounce without reflecting launch tokens", async () => {
    const result = await guardResource(
      () => allow,
      "fallback",
      okResource(),
    )(
      makeRequest("/?token=secret", {
        headers: {
          "sec-fetch-site": "cross-site",
          "sec-fetch-dest": "document",
        },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    const html = await result.text();
    expect(html).toContain("location.replace");
    expect(html).not.toContain("secret");
  });
});

describe("guardResource: request contract", () => {
  it("marks resource functions and guards them only once", () => {
    const once = guardResource(() => allow, "prefix", okResource());
    const twice = guardResource(() => deny, "prefix", once);
    expect(twice).toBe(once);
    expect(isGuarded(once)).toBe(true);
    expect((once as ResourceHandler & { [GUARDED]?: true })[GUARDED]).toBe(true);
  });

  it("falls back to LOGIN_PATH for an unsafe gate redirect", async () => {
    const gate: Gate = { decide: () => ({ deny: { redirect: "https://evil.example" } }) };
    const result = await guardResource(() => gate, "prefix", okResource())(makeRequest("/plugins"));
    expect(result.headers.get("location")).toBe("/auth/login");
  });

  it("keeps the absolute URL query available to bootstrap decisions", async () => {
    const seen: GuardRequest[] = [];
    const gate: Gate = {
      decide: (req) => {
        seen.push(req);
        return "deny";
      },
    };
    const guarded = guardResource(() => gate, "fallback", okResource());
    await guarded(makeRequest("/?token=k1", { headers: { "sec-fetch-mode": "navigate" } }));
    expect(seen[0]?.url).toBe("http://127.0.0.1:3080/?token=k1");
  });

  it("forwards cookie, authorization and Sec-Fetch headers to the gate", async () => {
    let captured: GuardRequest | undefined;
    const gate: Gate = {
      decide: (req) => {
        captured = req;
        return "allow";
      },
    };
    const headers = {
      cookie: "dsh_auth=abc",
      authorization: "Bearer t",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    };
    await guardResource(
      () => gate,
      "prefix",
      okResource(),
    )(makeRequest("/plugins/a.js", { headers }));
    expect(captured?.headers.cookie).toBe("dsh_auth=abc");
    expect(captured?.headers.authorization).toBe("Bearer t");
    expect(captured?.headers["sec-fetch-mode"]).toBe("navigate");
  });
});

describe("guardResource: failure handling", () => {
  it("returns 400 no-store for an invalid URL without calling gate or resource", async () => {
    let gateCalls = 0;
    let resourceCalls = 0;
    const gate: Gate = {
      decide: () => {
        gateCalls += 1;
        return "allow";
      },
    };
    const resource: ResourceHandler = () => {
      resourceCalls += 1;
      return reply("x");
    };
    const broken = {
      url: "http://[::1",
      method: "GET",
      headers: new Headers(),
    } as unknown as Request;
    const result = await guardResource(() => gate, "prefix", resource)(broken);
    expect(result.status).toBe(400);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(gateCalls).toBe(0);
    expect(resourceCalls).toBe(0);
  });

  it("propagates gate errors and resource rejections", async () => {
    const failing: Gate = {
      decide: () => {
        throw new Error("gate exploded");
      },
    };
    await expect(
      guardResource(() => failing, "prefix", okResource())(makeRequest("/plugins")),
    ).rejects.toThrow("gate exploded");
    const rejecting: ResourceHandler = () => Promise.reject(new Error("resource exploded"));
    await expect(
      guardResource(() => allow, "prefix", rejecting)(makeRequest("/plugins")),
    ).rejects.toThrow("resource exploded");
  });

  it("reads the current gate for every resource request", async () => {
    let gate: Gate = deny;
    const guarded = guardResource(() => gate, "prefix", okResource());
    expect((await guarded(makeRequest("/plugins"))).status).toBe(401);
    gate = allow;
    expect((await guarded(makeRequest("/plugins"))).status).toBe(200);
  });
});
