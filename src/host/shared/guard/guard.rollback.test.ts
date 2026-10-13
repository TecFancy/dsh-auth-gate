import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import {
  isGuarded,
  wrapServer,
  type GuardLog,
  type HttpHandler,
  type UpgradeHandler,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./guard.js";

const log: GuardLog = { error: () => undefined };

/** 与真实 webServer 同形：register 系方法写表、返回按 path 删除的 disposer。 */
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
      const table = route.kind === "exact" ? exact : prefixes;
      table.set(route.path, route);
      return () => table.delete(route.path);
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

describe("wrapServer: unwrap 逐条回滚", () => {
  const allow: Gate = { decide: () => "allow" };

  it("keeps exact and prefix routes registered after the wrap, with their original handler", () => {
    const server = makeFakeServer();
    const unwrap = wrapServer(server, () => allow, log);
    const exactHandler: HttpHandler = () => undefined;
    const prefixHandler: HttpHandler = () => undefined;
    server.register({ kind: "exact", path: "/late", handler: exactHandler });
    server.register({ kind: "prefix", path: "/late-p", handler: prefixHandler });
    expect(isGuarded(server.exact.get("/late")!.handler)).toBe(true);

    unwrap();

    expect(server.exact.get("/late")!.handler).toBe(exactHandler);
    expect(server.prefixes.get("/late-p")!.handler).toBe(prefixHandler);
  });

  it("keeps an upgrade route registered after the wrap, with its original handler", () => {
    const server = makeFakeServer();
    const unwrap = wrapServer(server, () => allow, log);
    const upgradeHandler: UpgradeHandler = () => undefined;
    server.registerUpgrade({ path: "/late-ws", handler: upgradeHandler });
    expect(isGuarded(server.upgrades.get("/late-ws")!.handler)).toBe(true);

    unwrap();

    expect(server.upgrades.get("/late-ws")!.handler).toBe(upgradeHandler);
  });

  it("does not resurrect a route deleted while the guard was mounted", () => {
    const server = makeFakeServer();
    server.exact.set("/gone", { kind: "exact", path: "/gone", handler: () => undefined });
    server.prefixes.set("/gone-p", { kind: "prefix", path: "/gone-p", handler: () => undefined });
    server.upgrades.set("/gone-ws", { path: "/gone-ws", handler: () => undefined });
    server.fallback = () => undefined;
    const unwrap = wrapServer(server, () => allow, log);

    server.exact.delete("/gone");
    server.prefixes.delete("/gone-p");
    server.upgrades.delete("/gone-ws");
    server.fallback = undefined;
    unwrap();

    expect(server.exact.has("/gone")).toBe(false);
    expect(server.prefixes.has("/gone-p")).toBe(false);
    expect(server.upgrades.has("/gone-ws")).toBe(false);
    expect(server.fallback).toBeUndefined();
  });

  it("keeps a fallback registered after the wrap, unguarded", () => {
    const server = makeFakeServer();
    const unwrap = wrapServer(server, () => allow, log);
    const fallbackHandler: HttpHandler = () => undefined;
    server.registerFallback(fallbackHandler);
    expect(isGuarded(server.fallback!)).toBe(true);

    unwrap();

    expect(server.fallback).toBe(fallbackHandler);
  });

  it("leaves an entry replaced by a foreign handler untouched", () => {
    const server = makeFakeServer();
    server.exact.set("/e", { kind: "exact", path: "/e", handler: () => undefined });
    server.upgrades.set("/u", { path: "/u", handler: () => undefined });
    server.fallback = () => undefined;
    const unwrap = wrapServer(server, () => allow, log);

    const foreignRoute: WrappableRoute = { kind: "exact", path: "/e", handler: () => undefined };
    const foreignUpgrade: WrappableUpgradeRoute = { path: "/u", handler: () => undefined };
    const foreignFallback: HttpHandler = () => undefined;
    server.exact.set("/e", foreignRoute);
    server.upgrades.set("/u", foreignUpgrade);
    server.fallback = foreignFallback;
    unwrap();

    expect(server.exact.get("/e")).toBe(foreignRoute);
    expect(server.upgrades.get("/u")).toBe(foreignUpgrade);
    expect(server.fallback).toBe(foreignFallback);
  });
});
