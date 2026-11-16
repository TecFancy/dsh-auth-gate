/**
 * 放行后重铸钩子在 `wrapServer` 上的透传：存量路由、晚注册路由与 fallback 座位都要拿到它。
 *
 * 漏掉任何一类，那个入口上的「门放行、宿主 401」就修不好；而晚注册与 fallback 恰恰是最容易
 * 漏的两类（前者靠替换后的 `register`，后者靠 `registerFallback` 的包装）。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import {
  wrapServer,
  type HttpHandler,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./guard.js";

const allowGate = (): Gate => ({ decide: () => "allow" });

interface Recorded {
  status: number;
  headers: Record<string, string>;
}

function makeReq(url: string): IncomingMessage {
  return { url, method: "GET", headers: {} } as unknown as IncomingMessage;
}

function makeRes(record: Recorded): ServerResponse {
  return {
    headersSent: false,
    setHeader: () => undefined,
    writeHead: (status: number, headers?: Record<string, string>) => {
      record.status = status;
      record.headers = headers ?? {};
    },
    end: () => undefined,
  } as unknown as ServerResponse;
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
    registerFallback(fallback) {
      server.fallback = fallback;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

function handlerAt(server: WrappableServer, path: string): HttpHandler {
  const route = server.exact.get(path);
  if (route?.handler === undefined) throw new Error(`handler missing at ${path}`);
  return route.handler;
}

describe("放行后重铸：wrapServer 透传", () => {
  it("存量路由、晚注册路由与 fallback 都拿到钩子", async () => {
    const server = makeServer();
    server.register({ kind: "exact", path: "/", handler: () => undefined });
    server.registerFallback(() => undefined);
    wrapServer(server, allowGate, { error: () => undefined }, undefined, () => ({
      location: "/?token=abc",
    }));

    const existing: Recorded = { status: 0, headers: {} };
    await handlerAt(server, "/")(makeReq("/"), makeRes(existing));
    expect(existing.status).toBe(302);

    server.register({ kind: "exact", path: "/late", handler: () => undefined });
    const late: Recorded = { status: 0, headers: {} };
    await handlerAt(server, "/late")(makeReq("/late"), makeRes(late));
    expect(late.status).toBe(302);

    const fallback = server.fallback;
    if (typeof fallback !== "function") throw new Error("fallback missing");
    const fallbackRecord: Recorded = { status: 0, headers: {} };
    await fallback(makeReq("/other"), makeRes(fallbackRecord));
    expect(fallbackRecord.status).toBe(302);
  });

  it("resource 形态的 fallback 也拿到钩子（生产里 / 由 frontend-static 的 resource fallback 承接）", async () => {
    const server = makeServer();
    let served = 0;
    server.registerFallback({
      resource: () => {
        served += 1;
        return Promise.resolve(new Response("index", { status: 200 }));
      },
    });
    wrapServer(server, allowGate, { error: () => undefined }, undefined, () => ({
      location: "/?token=abc",
    }));

    const fallback = server.fallback;
    if (fallback === null || fallback === undefined || typeof fallback === "function") {
      throw new Error("resource fallback missing");
    }
    const response = await fallback.resource(new Request("http://127.0.0.1:3080/"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/?token=abc");
    expect(served).toBe(0);
  });
});
