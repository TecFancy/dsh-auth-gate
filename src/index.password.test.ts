import type { Context } from "@deepseek-ai/cordis";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WrappableServer, WrappableRoute, WrappableUpgradeRoute } from "./gate/index.js";
import { apply, type AuthConfig, type AuthService } from "./index.js";
import { PasswordGate } from "./features/password/index.js";
import { TokenGate } from "./features/token/index.js";

const { capturedDeps } = vi.hoisted<{ capturedDeps: { current: unknown } }>(() => ({
  capturedDeps: { current: undefined },
}));

vi.mock("./features/password/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features/password/index.js")>();
  return {
    ...actual,
    registerPasswordEndpoints: (deps: unknown) => {
      capturedDeps.current = deps;
      return () => undefined;
    },
  };
});

function cfg(mode: "token" | "password", usersFile = ""): AuthConfig {
  return {
    mode,
    sessionTtl: 604800,
    cookieName: "dsh_auth",
    tokenRef: "DSH_AUTH_TOKEN",
    cookieSecure: true,
    usersFile,
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

function makeCtx(server: WrappableServer) {
  const gets: string[] = [];
  const provided: Record<string, unknown> = {};
  const disposers: (() => unknown)[] = [];
  const ctx = {
    get(serviceName: string): unknown {
      gets.push(serviceName);
      if (serviceName === "webServer") return server;
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
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      };
    },
    // M1 教训：effect 的 callback 在注册时同步执行并返回 disposer；disposer 只收集不执行
    effect(callback: () => unknown): void {
      const disposer = callback();
      if (typeof disposer === "function") disposers.push(disposer as () => unknown);
    },
  } as unknown as Context;
  return { ctx, gets, provided, disposers };
}

describe("apply: password mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    capturedDeps.current = undefined;
  });

  it("mounts a PasswordGate instead of throwing", () => {
    const server = makeFakeServer();
    const { ctx, provided } = makeCtx(server);
    expect(() => apply(ctx, cfg("password"))).not.toThrow();
    const auth = provided["auth"] as AuthService;
    expect(auth.gate).toBeInstanceOf(PasswordGate);
    // 端点注册经包装后的 server.register 走真实 registerPasswordEndpoints，由集成测试覆盖
  });

  it("never touches the credentials service", () => {
    const server = makeFakeServer();
    const { ctx, gets } = makeCtx(server);
    apply(ctx, cfg("password"));
    expect(gets).not.toContain("credentials");
  });

  it("still mounts a TokenGate in token mode and resolves credentials lazily", async () => {
    const server = makeFakeServer();
    const { ctx, provided, gets } = makeCtx(server);
    apply(ctx, cfg("token"));
    const auth = provided["auth"] as AuthService;
    expect(auth.gate).toBeInstanceOf(TokenGate);
    expect(gets).not.toContain("credentials"); // 惰性：apply 时未访问
    await auth.gate.decide({ headers: { authorization: "Bearer x" } } as never, "exact", "/probe");
    expect(gets).toContain("credentials");
  });

  it("resolves the default users path from DSH_HOME", () => {
    vi.stubEnv("DSH_HOME", "/srv/dsh");
    const server = makeFakeServer();
    const { ctx } = makeCtx(server);
    apply(ctx, cfg("password"));
    const deps = capturedDeps.current as { usersPath: string } | undefined;
    expect(deps?.usersPath).toBe(path.join("/srv/dsh", "auth", "users.yaml"));
  });

  it("honors an explicit usersFile config", () => {
    const server = makeFakeServer();
    const { ctx } = makeCtx(server);
    apply(ctx, cfg("password", "/x/users.yaml"));
    const deps = capturedDeps.current as { usersPath: string } | undefined;
    expect(deps?.usersPath).toBe("/x/users.yaml");
  });
});
