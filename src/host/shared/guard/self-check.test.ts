import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import {
  isGuarded,
  wrapServer,
  type GuardLog,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./guard.js";
import { assertGuarded } from "./self-check.js";

const log: GuardLog = { error: () => undefined };
const allowGate: Gate = { decide: () => "allow" };

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

describe("assertGuarded", () => {
  it("reports nothing when every entry is guarded", () => {
    const server = makeFakeServer();
    server.exact.set("/e", { kind: "exact", path: "/e", handler: () => undefined });
    server.prefixes.set("/p", { kind: "prefix", path: "/p", handler: () => undefined });
    server.upgrades.set("/u", { path: "/u", handler: () => undefined });
    server.fallback = () => undefined;
    wrapServer(server, () => allowGate, log);
    expect(assertGuarded(server)).toEqual([]);
  });

  it("names each unguarded entry", () => {
    const server = makeFakeServer();
    server.exact.set("/e", { kind: "exact", path: "/e", handler: () => undefined });
    server.fallback = () => undefined;
    wrapServer(server, () => allowGate, log);
    expect(assertGuarded(server)).toEqual([]);

    // Break coverage: replace register with an unguarded function, add a raw
    // table entry, and replace the fallback with an unguarded handler.
    const plainRegister = server.register.bind(server);
    server.register = (route) => plainRegister(route);
    server.exact.set("/naked", { kind: "exact", path: "/naked", handler: () => undefined });
    server.fallback = () => undefined;

    const failures = assertGuarded(server);
    expect(failures).toContain("exact /naked");
    expect(failures).toContain("fallback");
    expect(failures).toContain("method register");
    expect(isGuarded(server.exact.get("/e")!.handler)).toBe(true);
  });
});

describe("assertGuarded: resource routes", () => {
  it("accepts a fully guarded mixture of handler and resource entries", () => {
    const server = makeFakeServer();
    server.exact.set("/e", { kind: "exact", path: "/e", handler: () => undefined });
    server.prefixes.set("/plugins", {
      kind: "prefix",
      path: "/plugins",
      resource: () => Promise.resolve(new Response("x")),
    });
    server.fallback = { resource: () => Promise.resolve(new Response("spa")) };
    wrapServer(server, () => allowGate, log);
    expect(assertGuarded(server)).toEqual([]);
  });

  it("names unguarded resource routes and a resource fallback", () => {
    const server = makeFakeServer();
    server.prefixes.set("/plugins", {
      kind: "prefix",
      path: "/plugins",
      resource: () => Promise.resolve(new Response("x")),
    });
    server.fallback = { resource: () => Promise.resolve(new Response("spa")) };
    const failures = assertGuarded(server);
    expect(failures).toContain("prefix /plugins");
    expect(failures).toContain("fallback");
  });

  it("reports missing or malformed targets without throwing", () => {
    const server = makeFakeServer();
    server.exact.set("/broken", { kind: "exact", path: "/broken" } as unknown as WrappableRoute);
    expect(() => assertGuarded(server)).not.toThrow();
    expect(assertGuarded(server)).toContain("exact /broken");
  });
});
