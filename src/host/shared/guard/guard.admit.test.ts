/**
 * 守卫的放行钩子：`AdmitHook` 只在门给出 `allow` 之后调用一次，拒绝分支上永远不出现。
 *
 * 这是匿名上报挂进请求路径的唯一接缝，所以三种入口形态（handler / resource / upgrade）与
 * 存量 + 晚注册 + fallback 都要过一遍：漏掉任何一类，那个入口上的使用就不会被计数，而钩子
 * 若在 deny 分支上被调用，就等于把拒绝的请求也当成"在用"。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AdmitHook, Gate } from "./gate.js";
import { guardResource } from "./resource.js";
import {
  guardHttp,
  guardUpgrade,
  wrapServer,
  type HttpHandler,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./guard.js";

const allowGate = (): Gate => ({ decide: () => "allow" });
const denyGate = (): Gate => ({ decide: () => "deny" });

function makeReq(url: string): IncomingMessage {
  return { url, method: "GET", headers: {} } as unknown as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {
    headersSent: false,
    setHeader: () => undefined,
    writeHead: () => undefined,
    end: () => undefined,
  } as unknown as ServerResponse;
}

function makeSocket(): Duplex {
  return { write: () => undefined, destroy: () => undefined } as unknown as Duplex;
}

function makeServer(): WrappableServer {
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

/** 记录调用顺序的钩子。 */
function recorder(): { calls: string[]; hook: AdmitHook } {
  const calls: string[] = [];
  return { calls, hook: () => calls.push("admit") };
}

/** 表里的 handler（探针路由都带 handler，resource 形态不参与这些断言）。 */
function handlerAt(server: WrappableServer, path: string): HttpHandler {
  const route = server.exact.get(path);
  if (route?.handler === undefined) throw new Error(`handler missing at ${path}`);
  return route.handler;
}

/** fallback 座位的 handler。 */
function fallbackHandler(server: WrappableServer): HttpHandler {
  const fallback = server.fallback;
  if (typeof fallback !== "function") throw new Error("fallback handler missing");
  return fallback;
}

describe("放行钩子：三种入口", () => {
  it("在 handler 入口放行后调用一次，拒绝时一次都不调用", async () => {
    const { calls, hook } = recorder();
    const allowed = guardHttp(
      allowGate,
      "exact",
      () => {
        calls.push("handler");
      },
      hook,
    );
    await allowed(makeReq("/admitted"), makeRes());
    expect(calls).toEqual(["admit", "handler"]);

    const denied = guardHttp(
      denyGate,
      "exact",
      () => {
        calls.push("denied-handler");
      },
      hook,
    );
    await denied(makeReq("/rejected"), makeRes());
    expect(calls).toEqual(["admit", "handler"]);
  });

  it("在 upgrade 入口放行后调用，拒绝握手时不调用", async () => {
    const { calls, hook } = recorder();
    const allowed = guardUpgrade(
      allowGate,
      () => {
        calls.push("upgrade");
      },
      hook,
    );
    await allowed(makeReq("/events"), makeSocket(), Buffer.alloc(0));
    expect(calls).toEqual(["admit", "upgrade"]);

    const denied = guardUpgrade(
      denyGate,
      () => {
        calls.push("denied-upgrade");
      },
      hook,
    );
    await denied(makeReq("/events"), makeSocket(), Buffer.alloc(0));
    expect(calls).toEqual(["admit", "upgrade"]);
  });

  it("在 resource 入口放行后调用，拒绝时不调用", async () => {
    const { calls, hook } = recorder();
    const resource = guardResource(
      allowGate,
      "fallback",
      () => {
        calls.push("resource");
        return Promise.resolve(new Response("ok"));
      },
      hook,
    );
    const response = await resource(new Request("http://host/admitted"));
    expect(response.status).toBe(200);
    expect(calls).toEqual(["admit", "resource"]);

    const denied = guardResource(
      denyGate,
      "fallback",
      () => {
        calls.push("denied-resource");
        return Promise.resolve(new Response("nope"));
      },
      hook,
    );
    await denied(new Request("http://host/rejected"));
    expect(calls).toEqual(["admit", "resource"]);
  });
});

describe("放行钩子：wrapServer 接线", () => {
  it("把钩子接到存量表、晚注册与 fallback 上", async () => {
    const { calls, hook } = recorder();
    const server = makeServer();
    server.exact.set("/stored", {
      kind: "exact",
      path: "/stored",
      handler: () => {
        calls.push("stored");
      },
    });
    wrapServer(server, allowGate, { error: () => undefined }, hook);

    await handlerAt(server, "/stored")(makeReq("/stored"), makeRes());
    expect(calls).toEqual(["admit", "stored"]);

    server.register({
      kind: "prefix",
      path: "/late",
      handler: () => {
        calls.push("late");
      },
    });
    await handlerAt(server, "/late")(makeReq("/late/x"), makeRes());
    expect(calls).toEqual(["admit", "stored", "admit", "late"]);
    server.registerFallback(() => {
      calls.push("fallback");
    });
    await fallbackHandler(server)(makeReq("/anything"), makeRes());
    expect(calls).toEqual(["admit", "stored", "admit", "late", "admit", "fallback"]);
  });
});
