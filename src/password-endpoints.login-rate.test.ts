import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "./guard.js";
import { registerPasswordEndpoints, type PasswordEndpointsDeps } from "./password-endpoints.js";
import { LoginRateLimiter } from "./rate-limit.js";
import type { SessionStore } from "./session-store.js";

interface FakeRes {
  res: ServerResponse;
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

function makeRes(): FakeRes {
  const state = {
    status: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: "",
  };
  const res = {
    setHeader: (name: string, value: string): void => {
      state.headers[name.toLowerCase()] = value;
    },
    writeHead: (status: number, extra?: Record<string, string | number>): void => {
      state.status = status;
      for (const [name, value] of Object.entries(extra ?? {})) {
        state.headers[name.toLowerCase()] = String(value);
      }
    },
    end: (body?: string): void => {
      state.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return Object.assign(state, { res });
}

interface VerifyCall {
  storedHash: string;
  password: string;
}

interface Harness {
  deps: PasswordEndpointsDeps;
  routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[];
  logs: { level: string; message: unknown }[];
  verifyCalls: VerifyCall[];
  setStore(value: SessionStore | undefined): void;
  setUsers(users: Map<string, { passwordHash: string; disabled: boolean }>): void;
  setLoadError(error: Error): void;
  setMissing(): void;
  limiter: LoginRateLimiter;
}

function makeHarness(): Harness {
  const routes: Harness["routes"] = [];
  const logs: Harness["logs"] = [];
  const verifyCalls: VerifyCall[] = [];
  // 最小 fake：本文件用例只走 store.create（成功路径）；setStore(undefined) 覆盖 503 分支
  let store: SessionStore | undefined = {
    create: (subject: string) =>
      Promise.resolve({
        token: "fake-token",
        session: { subject, createdAt: 0, expiresAt: 0, revoked: false },
      }),
  } as unknown as SessionStore;
  let users = new Map([["alice", { passwordHash: "h-alice", disabled: false }]]);
  let loadError: Error | undefined;
  let missing = false;
  const limiter = new LoginRateLimiter({ now: () => 1_000_000 });
  return {
    routes,
    logs,
    verifyCalls,
    setStore: (value) => {
      store = value;
    },
    setUsers: (value) => {
      users = value;
    },
    setLoadError: (error) => {
      loadError = error;
    },
    setMissing: () => {
      missing = true;
    },
    limiter,
    deps: {
      register: (route) => {
        routes.push(route);
        return () => {
          const at = routes.indexOf(route);
          if (at !== -1) routes.splice(at, 1);
        };
      },
      sessions: () => store,
      cookieName: "dsh_auth",
      cookieSecure: false,
      sessionTtl: 604800,
      logoutOrder: 1000,
      usersPath: "/tmp/users.yaml",
      loadUsers: () => {
        if (loadError !== undefined) return Promise.reject(loadError);
        const empty = new Map<string, { passwordHash: string; disabled: boolean }>();
        return Promise.resolve({
          snapshot: { users: missing ? empty : users },
          missing,
        });
      },
      verify: (password, storedHash) => {
        verifyCalls.push({ storedHash, password });
        return Promise.resolve(password === "pw" && storedHash === "h-alice");
      },
      limiter,
      logger: {
        error: (message) => logs.push({ level: "error", message }),
        info: (message) => logs.push({ level: "info", message }),
        warn: (message) => logs.push({ level: "warn", message }),
      },
    },
  };
}

function handlerOf(harness: Harness, kind: "exact" | "prefix", path: string): HttpHandler {
  const route = harness.routes.find((r) => r.kind === kind && r.path === path);
  if (route === undefined) throw new Error(`route not found: ${kind} ${path}`);
  return route.handler;
}

function loginReq(body: string, remoteAddress = "127.0.0.1"): IncomingMessage {
  return {
    method: "POST",
    url: "/auth/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    socket: { remoteAddress },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      yield Buffer.from(body);
    },
  } as unknown as IncomingMessage;
}

describe("POST /auth/login: rate limiting", () => {
  it("returns 429 with retry-after while locked and skips verification", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    for (let i = 0; i < 5; i++) harness.limiter.recordFailure("127.0.0.1", "alice");
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.body).toBe("too many attempts");
    expect(harness.verifyCalls).toEqual([]);
    expect(harness.logs).toContainEqual({ level: "info", message: "rate limit exceeded" });
  });

  it("locks after five consecutive failures, then even a correct password is rejected", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      await handlerOf(
        harness,
        "exact",
        "/auth/login",
      )(loginReq("username=alice&password=wrong"), res.res);
      expect(res.status).toBe(401);
    }
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(429);
  });

  it("only touches the IP bucket for an empty username", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      await handlerOf(
        harness,
        "exact",
        "/auth/login",
      )(loginReq("username=&password=wrong", "9.9.9.9"), res.res);
      expect(res.status).toBe(401);
    }
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw", "1.1.1.1"), res.res);
    expect(res.status).toBe(302);
  });
});

describe("POST /auth/login: store errors", () => {
  it("returns 503 when the users file cannot be loaded, without counting a failure", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    harness.setLoadError(new Error("parse boom"));
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(503);
    expect(res.body).toBe("user store unavailable");
    expect(harness.logs).toContainEqual({
      level: "error",
      message: "user store unavailable: parse boom",
    });
  });

  it("returns 503 when the session store is unavailable", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    harness.setStore(undefined);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(503);
    expect(res.body).toBe("session store unavailable");
    expect(harness.logs).toContainEqual({
      level: "error",
      message: "login failed: session store unavailable",
    });
  });

  it("warns once when the users file is missing, then keeps rejecting with 401", async () => {
    const harness = makeHarness();
    harness.setMissing();
    registerPasswordEndpoints(harness.deps);
    for (let i = 0; i < 2; i++) {
      const res = makeRes();
      await handlerOf(
        harness,
        "exact",
        "/auth/login",
      )(loginReq("username=alice&password=pw"), res.res);
      expect(res.status).toBe(401);
    }
    const warns = harness.logs.filter((entry) => entry.level === "warn");
    expect(warns).toEqual([
      {
        level: "warn",
        message: "users file not found: /tmp/users.yaml (all password logins rejected)",
      },
    ]);
  });
});
