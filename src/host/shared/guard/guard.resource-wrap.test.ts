import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import {
  isGuarded,
  wrapServer,
  type GuardLog,
  type ResourceHandler,
  type WrappableResourceRoute,
  type WrappableServer,
} from "./guard.js";

const log: GuardLog = { error: () => undefined };

function reply(body: string): Promise<Response> {
  return Promise.resolve(new Response(body, { status: 200 }));
}

function makeRequest(path = "/plugins/a.js"): Request {
  return new Request(`http://127.0.0.1:3080${path}`);
}

function makeResourceServer(): WrappableServer {
  const exact = new Map<string, WrappableResourceRoute>();
  const prefixes = new Map<string, WrappableResourceRoute>();
  const server: WrappableServer = {
    exact,
    prefixes,
    upgrades: new Map(),
    fallback: undefined,
    register(route) {
      const table = route.kind === "exact" ? exact : prefixes;
      table.set(route.path, route as WrappableResourceRoute);
      return () => table.delete(route.path);
    },
    registerUpgrade: () => () => undefined,
    registerFallback(fallback) {
      server.fallback = fallback;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

describe("wrapServer with resource routes", () => {
  it("guards existing and late resource routes and a resource fallback", async () => {
    const server = makeResourceServer();
    const existing: ResourceHandler = () => reply("existing");
    const fallbackResource: ResourceHandler = () => reply("fallback");
    server.prefixes.set("/plugins", { kind: "prefix", path: "/plugins", resource: existing });
    server.fallback = { resource: fallbackResource };
    wrapServer(server, () => ({ decide: () => "deny" }), log);

    const existingGuarded = server.prefixes.get("/plugins") as WrappableResourceRoute;
    expect(isGuarded(existingGuarded.resource)).toBe(true);
    expect((await existingGuarded.resource(makeRequest())).status).toBe(401);

    server.register({ kind: "prefix", path: "/late", resource: () => reply("late") });
    const lateGuarded = server.prefixes.get("/late");
    if (lateGuarded === undefined || !("resource" in lateGuarded)) {
      throw new Error("late resource route is missing");
    }
    expect(isGuarded(lateGuarded.resource)).toBe(true);
    expect((await lateGuarded.resource(makeRequest("/late/x"))).status).toBe(401);

    const fallback = server.fallback;
    if (fallback === undefined || typeof fallback === "function") {
      throw new Error("fallback is not a resource");
    }
    expect(isGuarded(fallback.resource)).toBe(true);
    expect((await fallback.resource(makeRequest("/"))).status).toBe(401);
  });

  it("second wrapServer returns the same unwrap and does not re-wrap", () => {
    const server = makeResourceServer();
    const resource: ResourceHandler = () => reply("x");
    server.prefixes.set("/plugins", { kind: "prefix", path: "/plugins", resource });
    const gate: Gate = { decide: () => "deny" };
    const unwrap = wrapServer(server, () => gate, log);
    const again = wrapServer(server, () => gate, log);
    expect(again).toBe(unwrap);
    const guarded = server.prefixes.get("/plugins");
    expect(guarded?.resource).not.toBe(resource);
  });
});
