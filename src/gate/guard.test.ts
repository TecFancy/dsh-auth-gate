import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import {
  denyHttp,
  guardHttp,
  isGuarded,
  wrapServer,
  type GuardLog,
  type HttpHandler,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./guard.js";

const log: GuardLog = { error: () => undefined };

interface ResState {
  status: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}
type FakeRes = ServerResponse & { state: ResState };

interface SocketState {
  written: string | undefined;
  destroyed: boolean | undefined;
}
type FakeSocket = Duplex & { state: SocketState };

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
    registerFallback(handler) {
      server.fallback = handler;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

function makeReq(
  url: string,
  method = "GET",
  accept?: string,
  extra?: Record<string, string>,
): IncomingMessage {
  return {
    url,
    method,
    headers: accept === undefined ? { ...extra } : { accept, ...extra },
  } as unknown as IncomingMessage;
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

function makeSocket(): FakeSocket {
  const state: SocketState = { written: undefined, destroyed: undefined };
  return {
    state,
    write(data: string) {
      state.written = String(data);
    },
    destroy() {
      state.destroyed = true;
    },
  } as unknown as FakeSocket;
}

describe("wrapServer: 存量与增量包装", () => {
  it("wraps existing entries and calls the original handler on allow", async () => {
    const server = makeFakeServer();
    let exactCalls = 0;
    let prefixCalls = 0;
    let upgradeCalls = 0;
    let fallbackCalls = 0;
    server.exact.set("/e", {
      kind: "exact",
      path: "/e",
      handler: () => {
        exactCalls += 1;
      },
    });
    server.prefixes.set("/p", {
      kind: "prefix",
      path: "/p",
      handler: () => {
        prefixCalls += 1;
      },
    });
    server.upgrades.set("/u", {
      path: "/u",
      handler: () => {
        upgradeCalls += 1;
      },
    });
    server.fallback = () => {
      fallbackCalls += 1;
    };

    wrapServer(server, () => ({ decide: () => "allow" as const }), log);

    expect(isGuarded(server.exact.get("/e")!.handler)).toBe(true);
    expect(isGuarded(server.prefixes.get("/p")!.handler)).toBe(true);
    expect(isGuarded(server.upgrades.get("/u")!.handler)).toBe(true);
    expect(isGuarded(server.fallback)).toBe(true);

    await server.exact.get("/e")!.handler(makeReq("/e"), makeRes());
    await server.prefixes.get("/p")!.handler(makeReq("/p"), makeRes());
    await server.upgrades.get("/u")!.handler(makeReq("/u"), makeSocket(), Buffer.alloc(0));
    await server.fallback(makeReq("/x"), makeRes());
    expect(exactCalls).toBe(1);
    expect(prefixCalls).toBe(1);
    expect(upgradeCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
  });

  it("guards routes registered after wrapServer", async () => {
    const server = makeFakeServer();
    let called = false;
    wrapServer(server, () => ({ decide: () => "deny" as const }), log);
    server.register({
      kind: "exact",
      path: "/late",
      handler: () => {
        called = true;
      },
    });

    const handler = server.exact.get("/late")!.handler;
    expect(isGuarded(handler)).toBe(true);
    const res = makeRes();
    await handler(makeReq("/late", "GET", "application/json"), res);
    expect(res.state.status).toBe(401);
    expect(called).toBe(false);
  });
});

describe("wrapServer: 幂等与还原", () => {
  it("is idempotent and unwrap restores the pre-wrap state", () => {
    const server = makeFakeServer();
    const originalRoute: WrappableRoute = { kind: "exact", path: "/e", handler: () => undefined };
    const originalFallback: HttpHandler = () => undefined;
    server.exact.set("/e", originalRoute);
    server.fallback = originalFallback;
    const gate: Gate = { decide: () => "allow" };

    const unwrap1 = wrapServer(server, () => gate, log);
    const unwrap2 = wrapServer(server, () => gate, log);
    expect(unwrap1).toBe(unwrap2);

    unwrap1();
    expect(server.exact.get("/e")).toBe(originalRoute);
    expect(server.fallback).toBe(originalFallback);
    expect(isGuarded(server.exact.get("/e")!.handler)).toBe(false);

    const unwrap3 = wrapServer(server, () => gate, log);
    expect(unwrap3).not.toBe(unwrap1);
  });

  it("reads the current gate per request", async () => {
    const server = makeFakeServer();
    server.exact.set("/probe", { kind: "exact", path: "/probe", handler: () => undefined });
    let gate: Gate = { decide: () => "deny" };
    wrapServer(server, () => gate, log);
    const handler = server.exact.get("/probe")!.handler;

    const res = makeRes();
    await handler(makeReq("/probe", "GET", "application/json"), res);
    expect(res.state.status).toBe(401);

    gate = { decide: () => "allow" };
    const res2 = makeRes();
    await handler(makeReq("/probe"), res2);
    expect(res2.state.status).toBeUndefined();
  });
});

describe("denyHttp", () => {
  it("redirects navigation with 302 + next and no-store", () => {
    const res = makeRes();
    denyHttp(makeReq("/some/path", "GET", "text/html"), res);
    expect(res.state.status).toBe(302);
    expect(res.state.headers!["location"]).toBe("/auth/login?next=%2Fsome%2Fpath");
    expect(res.state.headers!["cache-control"]).toBe("no-store");
  });

  it("rejects non-navigation with 401", () => {
    const res = makeRes();
    denyHttp(makeReq("/api/x", "GET", "application/json"), res);
    expect(res.state.status).toBe(401);
    expect(res.state.body).toBe("unauthorized");

    const res2 = makeRes();
    denyHttp(makeReq("/api/x", "POST"), res2);
    expect(res2.state.status).toBe(401);
  });
});

describe("guardUpgrade + denyUpgrade", () => {
  it("rejects upgrades before negotiation and allows them through", async () => {
    const server = makeFakeServer();
    let calls = 0;
    server.upgrades.set("/api/events.host", {
      path: "/api/events.host",
      handler: () => {
        calls += 1;
      },
    });
    let gate: Gate = { decide: () => "deny" };
    wrapServer(server, () => gate, log);
    const handler = server.upgrades.get("/api/events.host")!.handler;

    const socket = makeSocket();
    await handler(makeReq("/api/events.host"), socket, Buffer.alloc(0));
    expect(socket.state.written).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
    expect(socket.state.destroyed).toBe(true);
    expect(calls).toBe(0);

    gate = { decide: () => "allow" };
    const socket2 = makeSocket();
    await handler(makeReq("/api/events.host"), socket2, Buffer.alloc(0));
    expect(calls).toBe(1);
    expect(socket2.state.destroyed).toBeUndefined();
  });
});

describe("guardHttp error behavior", () => {
  it("propagates handler errors instead of swallowing them", async () => {
    const gate: Gate = { decide: () => "allow" };
    const guarded = guardHttp(
      () => gate,
      "exact",
      () => {
        throw new Error("boom");
      },
    );
    await expect(guarded(makeReq("/"), makeRes())).rejects.toThrow("boom");
  });
});
