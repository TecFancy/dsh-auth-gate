import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  isGuarded,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig, type AuthService } from "./index.js";
import { SessionStore, type Session } from "./session/index.js";
import { TokenGate } from "./features/token/index.js";
function cfg(): AuthConfig {
  return {
    mode: "token",
    sessionTtl: 604800,
    cookieName: "dsh_auth",
    tokenRef: "DSH_AUTH_TOKEN",
    cookieSecure: true,
    usersFile: "",
    totp: "off",
    logoutOrder: 1000,
  };
}
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
interface FakeLog {
  level: string;
  message: unknown;
}
function makeCtx(
  server: WrappableServer | undefined,
  storageDomain: unknown,
  credentials?: unknown,
) {
  const effects: (() => unknown)[] = [];
  const logs: FakeLog[] = [];
  const provided: Record<string, unknown> = {};
  const ctx = {
    get(serviceName: string): unknown {
      if (serviceName === "webServer") return server;
      if (serviceName === "storageDomain") return storageDomain;
      if (serviceName === "credentials") return credentials;
      return undefined;
    },
    provide(serviceName: string, value: unknown): void {
      provided[serviceName] = value;
    },
    logger(): {
      error(message: unknown): void;
      info(message: unknown): void;
      warn(message: unknown): void;
    } {
      return {
        error: (message) => logs.push({ level: "error", message }),
        info: (message) => logs.push({ level: "info", message }),
        warn: (message) => logs.push({ level: "warn", message }),
      };
    },
    effect(callback: () => unknown): void {
      const disposer = callback();
      if (typeof disposer === "function") effects.push(disposer as () => unknown);
    },
  } as unknown as Context;
  return { ctx, effects, logs, provided };
}
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
function bearerReq(token: string): IncomingMessage {
  return { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
}
describe("dsh-auth-gate plugin shape", () => {
  it("uses the stable plugin name and inject list", () => {
    expect(name).toBe("dsh-auth-gate");
    expect(inject).toContain("webServer");
  });
});
describe("Config", () => {
  it("fills defaults from an empty config", () => {
    expect(Config({} as AuthConfig)).toEqual(cfg());
  });
  it("rejects a tokenRef that is not a credential reference", () => {
    expect(() => Config({ tokenRef: "1bad-ref" } as AuthConfig)).toThrow();
  });
});
describe("apply: mode 与装配", () => {
  it("returns silently when webServer is absent", () => {
    const { ctx, provided } = makeCtx(undefined, undefined);
    expect(() => apply(ctx, cfg())).not.toThrow();
    expect(provided["auth"]).toBeUndefined();
  });
  it("mounts a TokenGate and logs when storageDomain is missing", () => {
    const server = makeFakeServer();
    server.exact.set("/probe", { kind: "exact", path: "/probe", handler: () => undefined });
    const { ctx, logs, provided } = makeCtx(server, undefined);
    expect(() => apply(ctx, cfg())).not.toThrow();
    expect(isGuarded(server.exact.get("/probe")!.handler)).toBe(true);
    const auth = provided["auth"] as AuthService;
    expect(auth.gate).toBeInstanceOf(TokenGate);
    expect(auth.sessions).toBeUndefined();
    expect(
      logs.some(
        (e) => e.level === "error" && String(e.message).includes("storage-domain is unavailable"),
      ),
    ).toBe(true);
  });
  it("denies via bearer and logs when credential resolution fails", async () => {
    const server = makeFakeServer();
    const { ctx, logs, provided } = makeCtx(server, undefined, {
      resolve: () => Promise.reject(new Error("boom")),
    });
    apply(ctx, cfg());
    const auth = provided["auth"] as AuthService;
    await expect(auth.gate.decide(bearerReq("x"), "exact", "/probe")).resolves.toBe("deny");
    expect(
      logs.some(
        (e) => e.level === "error" && String(e.message).includes("token resolution failed"),
      ),
    ).toBe(true);
  });
  it("allows a correct bearer token through the mounted gate", async () => {
    const server = makeFakeServer();
    const { ctx, provided } = makeCtx(server, undefined, {
      resolve: () => Promise.resolve({ value: "good-token", source: "test" }),
    });
    apply(ctx, cfg());
    const auth = provided["auth"] as AuthService;
    await expect(auth.gate.decide(bearerReq("good-token"), "exact", "/probe")).resolves.toBe(
      "allow",
    );
    await expect(auth.gate.decide(bearerReq("bad"), "exact", "/probe")).resolves.toBe("deny");
  });
});
describe("apply: 自检", () => {
  it("fails loud when an entry is not guarded", () => {
    const server = makeFakeServer();
    server.exact.set("/probe", { kind: "exact", path: "/probe", handler: () => undefined });
    const { ctx, logs } = makeCtx(server, undefined);
    apply(ctx, cfg());
    // Break the register method after the first apply.
    const plainRegister = server.register.bind(server);
    server.register = (route) => plainRegister(route);
    expect(() => apply(ctx, cfg())).toThrow(/guard self-check failed/);
    expect(
      logs.some((e) => e.level === "error" && String(e.message).includes("method register")),
    ).toBe(true);
  });
});
describe("apply: 会话层接线", () => {
  it("wires the session store when storageDomain opens", async () => {
    const server = makeFakeServer();
    const table = new Map<string, Session>();
    const fakeDomain = {
      table: () => table,
      close: () => undefined,
    };
    const { ctx, provided } = makeCtx(server, { open: () => Promise.resolve(fakeDomain) });
    apply(ctx, cfg());
    const auth = provided["auth"] as AuthService;
    expect(auth.sessions).toBeUndefined();
    await flush();
    expect(auth.sessions).toBeInstanceOf(SessionStore);
  });
  it("logs and keeps guards mounted when the domain open fails", async () => {
    const server = makeFakeServer();
    server.exact.set("/probe", { kind: "exact", path: "/probe", handler: () => undefined });
    const { ctx, logs, provided } = makeCtx(server, {
      open: () => Promise.reject(new Error("boom")),
    });
    expect(() => apply(ctx, cfg())).not.toThrow();
    await flush();
    const auth = provided["auth"] as AuthService;
    expect(auth.sessions).toBeUndefined();
    expect(isGuarded(server.exact.get("/probe")!.handler)).toBe(true);
    expect(
      logs.some((entry) => entry.level === "error" && String(entry.message).includes("boom")),
    ).toBe(true);
  });
  it("restores the guard, unregisters endpoints and closes the domain on dispose", async () => {
    const server = makeFakeServer();
    const originalRoute: WrappableRoute = {
      kind: "exact",
      path: "/probe",
      handler: () => undefined,
    };
    server.exact.set("/probe", originalRoute);
    const closed: string[] = [];
    const fakeDomain = {
      table: () => new Map<string, Session>(),
      close: () => {
        closed.push("close");
      },
    };
    const { ctx, effects } = makeCtx(server, { open: () => Promise.resolve(fakeDomain) });
    apply(ctx, cfg());
    await flush();
    expect(server.exact.has("/auth/login")).toBe(true);
    for (const disposer of [...effects].reverse()) {
      await disposer();
    }
    expect(server.exact.get("/probe")).toBe(originalRoute);
    expect(server.exact.has("/auth/login")).toBe(false);
    expect(closed).toContain("close");
  });
  it("closes a domain that resolves after disposal", async () => {
    const server = makeFakeServer();
    let resolveOpen: (domain: unknown) => void = () => undefined;
    const closed: string[] = [];
    const { ctx, effects } = makeCtx(server, {
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    apply(ctx, cfg());
    const disposerResults = [...effects].reverse().map((disposer) => disposer());
    resolveOpen({
      table: () => new Map<string, Session>(),
      close: () => {
        closed.push("close");
      },
    });
    await Promise.all(disposerResults);
    await flush();
    expect(closed).toContain("close");
  });
});
