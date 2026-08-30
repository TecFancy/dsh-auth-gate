import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "../../gate/index.js";
import { registerPasswordEndpoints, type PasswordEndpointsDeps } from "./password-endpoints.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { SessionStore, type Session } from "../../session/index.js";

class MemTable implements KvTable<string, Session> {
  private readonly map = new Map<string, Session>();

  get size(): number {
    return this.map.size;
  }

  get(key: string): Session | undefined {
    return this.map.get(key);
  }

  entries(): IterableIterator<[string, Session]> {
    return this.map.entries();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  put(key: string, value: Session): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.map.delete(key));
  }

  update(key: string, fn: (current: Session) => Session): Promise<Session> {
    const current = this.map.get(key);
    if (current === undefined) throw new Error("missing-key");
    const next = fn(current);
    this.map.set(key, next);
    return Promise.resolve(next);
  }
}

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
      state.headers[name.toLowerCase()] = String(value);
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
  table: MemTable;
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
  const table = new MemTable();
  const logs: Harness["logs"] = [];
  const verifyCalls: VerifyCall[] = [];
  let store: SessionStore | undefined = new SessionStore(table);
  let users = new Map([["alice", { passwordHash: "h-alice", disabled: false }]]);
  let loadError: Error | undefined;
  let missing = false;
  const limiter = new LoginRateLimiter({ now: () => 1_000_000 });
  return {
    routes,
    table,
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
      totpMode: "off",
      verifyTotp: () => undefined,
      replayCheck: () => true,
      now: () => 1_700_000_000_000,
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

describe("POST /auth/login: disabled and next", () => {
  it("still verifies the real hash for disabled users before rejecting", async () => {
    const harness = makeHarness();
    harness.setUsers(new Map([["alice", { passwordHash: "h-alice", disabled: true }]]));
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(401);
    expect(harness.verifyCalls).toEqual([{ storedHash: "h-alice", password: "pw" }]);
  });

  it("validates next: //evil.com and /auth/* fall back to /", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    for (const [next, expected] of [
      ["//evil.com", "/"],
      ["/ok/path", "/ok/path"],
      ["/auth/login", "/"],
      ["/auth/x", "/"],
    ] as const) {
      const res = makeRes();
      await handlerOf(
        harness,
        "exact",
        "/auth/login",
      )(loginReq(`username=alice&password=pw&next=${encodeURIComponent(next)}`), res.res);
      expect(res.headers["location"]).toBe(expected);
    }
  });
});
