import { describe, expect, it } from "vitest";
import { isGuarded, type WrappableRoute } from "./host/shared/guard/index.js";
import { apply, Config, inject, name, type AuthService } from "./index.js";
import { SessionStore, type Session } from "./host/entities/session/index.js";
import { TokenGate } from "./host/features/token/index.js";
import {
  INSTALL_ID,
  cfg,
  flush,
  makeCtx,
  makeFakeServer,
  bearerReq,
  loggedError,
} from "../test/plugin-shape-harness.js";

describe("dsh-auth-gate plugin shape", () => {
  it("uses the stable plugin name and inject list", () => {
    expect(name).toBe("dsh-auth-gate");
    expect(inject).toContain("webServer");
  });
});
describe("Config", () => {
  it("fills defaults from an empty config", () => {
    expect({ ...Config({}), installId: INSTALL_ID }).toEqual(cfg());
  });
  it("rejects a tokenRef that is not a credential reference", () => {
    expect(() => Config({ tokenRef: "1bad-ref" })).toThrow();
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
    expect(loggedError(logs, "storage-domain is unavailable")).toBe(true);
  });
  it("denies via bearer and logs when credential resolution fails", async () => {
    const server = makeFakeServer();
    const { ctx, logs, provided } = makeCtx(server, undefined, {
      resolve: () => Promise.reject(new Error("boom")),
    });
    apply(ctx, cfg());
    const auth = provided["auth"] as AuthService;
    await expect(auth.gate.decide(bearerReq("x"), "exact", "/probe")).resolves.toBe("deny");
    expect(loggedError(logs, "token resolution failed")).toBe(true);
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
