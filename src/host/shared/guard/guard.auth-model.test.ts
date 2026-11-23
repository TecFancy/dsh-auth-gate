import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import {
  isGuarded,
  wrapServer,
  type GuardLog,
  type HostAuthPolicy,
  type HostAuthRequest,
  type HostAuthRule,
  type HttpHandler,
  type WrappableFallback,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./guard.js";

const log: GuardLog = { error: () => undefined };
const allow: Gate = { decide: () => "allow" };

interface ResState {
  status: number | undefined;
  body: string | undefined;
}
type FakeRes = ServerResponse & { state: ResState };

function makeFakeServer(): WrappableServer {
  const exact = new Map<string, WrappableRoute>();
  const prefixes = new Map<string, WrappableRoute>();
  const upgrades = new Map<string, WrappableUpgradeRoute>();
  const server: WrappableServer = {
    exact,
    prefixes,
    upgrades,
    fallback: undefined,
    register(route) {
      exact.set(route.path, route);
      return () => exact.delete(route.path);
    },
    registerUpgrade(route) {
      upgrades.set(route.path, route);
      return () => upgrades.delete(route.path);
    },
    registerFallback(fallback) {
      server.fallback = fallback;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

function makeSocket(): Duplex {
  return {
    write: () => undefined,
    end: () => undefined,
    on: () => undefined,
    destroy: () => undefined,
  } as unknown as Duplex;
}

function makeReq(url: string): IncomingMessage {
  return { url, method: "GET", headers: {} } as unknown as IncomingMessage;
}

function makeRes(): FakeRes {
  const state: ResState = { status: undefined, body: undefined };
  return {
    state,
    headersSent: false,
    setHeader: () => undefined,
    writeHead(status: number) {
      state.status = status;
    },
    end(body?: string) {
      state.body = body;
    },
  } as unknown as FakeRes;
}

function authRequest(headers: HostAuthRequest["headers"] = {}): HostAuthRequest {
  return { headers, method: "GET", url: new URL("http://127.0.0.1/"), transport: "http" };
}

function policyOf(rule: HostAuthRule | undefined, request = authRequest()): string {
  if (rule === undefined) return "required";
  return typeof rule === "function" ? rule(request) : rule;
}

/** 读头：`Headers` 与普通表两种形态都要能读（适配器在宿主里两种都见得到）。 */
function headerOf(headers: HostAuthRequest["headers"], name: string): string | undefined {
  return headers instanceof Headers ? (headers.get(name) ?? undefined) : headers[name]?.toString();
}

describe("guard entries forward the host-admitted Peer (0.2.3-alpha.2)", () => {
  it("guardHttp passes the trailing Peer to the wrapped handler", async () => {
    const seen: unknown[] = [];
    const server = makeFakeServer();
    const handler: HttpHandler = (_req, res, peer) => {
      seen.push(peer);
      res.writeHead(200);
      res.end("ok");
    };
    server.exact.set("/api/x", { kind: "prefix", path: "/api/x", handler });
    wrapServer(server, () => allow, log);
    const guarded = server.exact.get("/api/x")!.handler!;
    const peer = { id: "peer-owner" };
    await guarded(makeReq("/api/x"), makeRes(), peer);
    expect(seen).toEqual([peer]);
  });

  it("guardUpgrade passes the trailing Peer to the wrapped upgrade handler", async () => {
    const seen: unknown[] = [];
    const server = makeFakeServer();
    server.upgrades.set("/api/remote.mux", {
      path: "/api/remote.mux",
      handler: (_req, _socket, _head, peer) => {
        seen.push(peer);
      },
    });
    wrapServer(server, () => allow, log);
    const peer = { id: "peer-api" };
    await server.upgrades
      .get("/api/remote.mux")!
      .handler(makeReq("/api/remote.mux"), makeSocket(), Buffer.alloc(0), peer);
    expect(seen).toEqual([peer]);
  });
});

describe("wrapServer preserves host route auth (0.2.3-alpha.2)", () => {
  it("keeps a fixed and a function auth rule on wrapped and late routes", () => {
    const rule: HostAuthRule = () => "anonymous";
    const server = makeFakeServer();
    server.exact.set("/api", {
      kind: "prefix",
      path: "/api",
      handler: () => undefined,
      auth: rule,
    });
    wrapServer(server, () => allow, log);
    expect(server.exact.get("/api")!.auth).toBe(rule);

    server.register({ kind: "exact", path: "/late", handler: () => undefined, auth: "anonymous" });
    expect(server.exact.get("/late")!.auth).toBe("anonymous");
  });

  it("composes the fallback auth adapter over the host rule and keeps the rest anonymous", () => {
    const adapter = (
      original: HostAuthRule | undefined,
      request: HostAuthRequest,
    ): HostAuthPolicy => {
      const policy = typeof original === "function" ? original(request) : (original ?? "required");
      if (policy !== "required") return policy;
      return headerOf(request.headers, "authorization") === undefined ? "anonymous" : "required";
    };
    const server = makeFakeServer();
    server.fallback = {
      resource: () => Promise.resolve(new Response("index")),
      auth: (request) => (request.url.pathname === "/" ? "required" : "anonymous"),
    };
    wrapServer(server, () => allow, log, undefined, undefined, adapter);

    const fallback = server.fallback;
    if (fallback === undefined || typeof fallback === "function") throw new Error("missing");
    expect(policyOf(fallback.auth)).toBe("anonymous");
    expect(policyOf(fallback.auth, authRequest({ authorization: "Bearer api" }))).toBe("required");
    expect(
      policyOf(fallback.auth, { ...authRequest(), url: new URL("http://x/assets/a.js") }),
    ).toBe("anonymous");
    expect(isGuarded(fallback.resource)).toBe(true);
  });

  it("keeps a function fallback a function even when an auth adapter is passed", async () => {
    // 0.1.x/0.2.x 只接受函数或 `{ resource }`：把函数换成 `{ handler }` 会让它接不到任何请求。
    const adapter = (): HostAuthPolicy => "anonymous";
    const server = makeFakeServer();
    let calls = 0;
    const original = () => {
      calls += 1;
    };
    server.fallback = original;
    const unwrap = wrapServer(server, () => allow, log, undefined, undefined, adapter);
    const wrapped = server.fallback;
    expect(typeof wrapped).toBe("function");
    if (typeof wrapped !== "function") throw new Error("fallback shape changed");
    await wrapped(makeReq("/x"), makeRes());
    expect(calls).toBe(1);
    unwrap();
    expect(server.fallback).toBe(original);
  });

  it("wraps a { handler } fallback and restores the original object on unwrap", async () => {
    let calls = 0;
    const original: WrappableFallback = {
      handler: () => {
        calls += 1;
      },
      auth: "anonymous",
    };
    const server = makeFakeServer();
    server.fallback = original;
    const unwrap = wrapServer(server, () => allow, log);
    const wrapped = server.fallback;
    if (wrapped === undefined || typeof wrapped === "function") throw new Error("missing");
    if (wrapped.handler === undefined) throw new Error("handler fallback missing");
    expect(isGuarded(wrapped.handler)).toBe(true);
    await wrapped.handler(makeReq("/"), makeRes());
    expect(calls).toBe(1);
    unwrap();
    expect(server.fallback).toBe(original);
  });
});
