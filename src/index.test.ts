import { describe, expect, it } from "vitest";
import { isGuarded, type WrappableRoute } from "./host/shared/guard/index.js";
import { apply, Config, inject, name, type AuthService } from "./index.js";
import { SessionStore, type Session } from "./host/entities/session/index.js";
import { TokenGate } from "./host/features/token/index.js";
import {
  CONDITIONAL_UI,
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
    // 两个 volatile 盒子（installId / passkeyConditionalUi）带 symbol 键，换成夹具里的同一引用再比。
    expect({ ...Config({}), installId: INSTALL_ID, passkeyConditionalUi: CONDITIONAL_UI }).toEqual(
      cfg(),
    );
  });
  it("rejects a tokenRef that is not a credential reference", () => {
    expect(() => Config({ tokenRef: "1bad-ref" })).toThrow();
  });
  it("defaults the token entropy floor to 32 and refuses a lower floor (L4)", () => {
    expect(Config({}).tokenMinLength).toBe(32);
    expect(Config({ tokenMinLength: 64 }).tokenMinLength).toBe(64);
    expect(() => Config({ tokenMinLength: 31 })).toThrow();
    expect(() => Config({ tokenMinLength: 0 })).toThrow();
  });
});
describe("apply: mode 与装配", () => {
  it("logs and throws when webServer is absent instead of silently disarming (G5)", () => {
    const { ctx, logs, provided } = makeCtx(undefined, undefined);
    expect(() => apply(ctx, cfg())).toThrow(/webServer is unavailable/);
    expect(loggedError(logs, "webServer is unavailable")).toBe(true);
    // 抛错发生在 provide 之前：没有留下半个可用的 auth 服务。
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
      resolve: () => Promise.resolve({ value: "x".repeat(32), source: "test" }),
    });
    apply(ctx, cfg());
    const auth = provided["auth"] as AuthService;
    await expect(auth.gate.decide(bearerReq("x".repeat(32)), "exact", "/probe")).resolves.toBe(
      "allow",
    );
    await expect(auth.gate.decide(bearerReq("bad"), "exact", "/probe")).resolves.toBe("deny");
  });
  it("fails closed and logs when the stored token is below tokenMinLength (L4)", async () => {
    const server = makeFakeServer();
    const short = "x".repeat(31);
    const { ctx, logs, provided } = makeCtx(server, undefined, {
      resolve: () => Promise.resolve({ value: short, source: "test" }),
    });
    apply(ctx, cfg({ tokenMinLength: 32 }));
    const auth = provided["auth"] as AuthService;
    // 长度不足的令牌即使逐字节正确也不放行（只报一次错，按无凭证处理）。
    await expect(auth.gate.decide(bearerReq(short), "exact", "/probe")).resolves.toBe("deny");
    await expect(auth.gate.decide(bearerReq(short), "exact", "/probe")).resolves.toBe("deny");
    expect(loggedError(logs, "shorter than tokenMinLength")).toBe(true);
    expect(logs.filter((entry) => String(entry.message).includes("shorter than")).length).toBe(1);
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
});

describe("apply: 会话层释放与失败可见性 (G6)", () => {
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
  it("closes a domain that resolves after disposal without publishing it (G6)", async () => {
    const server = makeFakeServer();
    let resolveOpen: (domain: unknown) => void = () => undefined;
    const closed: string[] = [];
    const { ctx, effects, provided } = makeCtx(server, {
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    apply(ctx, cfg());
    const auth = provided["auth"] as AuthService;
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
    // 释放之后解析出来的 domain 只关闭，不发布：没有 auth.sessions 可被晚到的请求读到。
    expect(auth.sessions).toBeUndefined();
  });
});

describe("apply: 会话层失败可见性 (G6)", () => {
  it("logs an operator-visible error when building the store fails (G6)", async () => {
    const server = makeFakeServer();
    const closed: string[] = [];
    const { ctx, logs, provided } = makeCtx(server, {
      open: () =>
        Promise.resolve({
          table: () => {
            throw new Error("table boom");
          },
          close: () => {
            closed.push("close");
          },
        }),
    });
    expect(() => apply(ctx, cfg())).not.toThrow();
    await flush();
    const auth = provided["auth"] as AuthService;
    expect(auth.sessions).toBeUndefined();
    expect(
      logs.some(
        (entry) =>
          entry.level === "error" &&
          String(entry.message).includes("session domain setup failed") &&
          String(entry.message).includes("table boom"),
      ),
    ).toBe(true);
    expect(closed).toContain("close");
  });
  it("clears the published session store on dispose (G6)", async () => {
    const server = makeFakeServer();
    const fakeDomain = {
      table: () => new Map<string, Session>(),
      close: () => undefined,
    };
    const { ctx, effects, provided } = makeCtx(server, { open: () => Promise.resolve(fakeDomain) });
    apply(ctx, cfg());
    await flush();
    const auth = provided["auth"] as AuthService;
    expect(auth.sessions).toBeInstanceOf(SessionStore);
    for (const disposer of [...effects].reverse()) await disposer();
    expect(auth.sessions).toBeUndefined();
  });
});
