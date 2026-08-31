import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "../../gate/index.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { SessionStore, type Session } from "../../session/index.js";
import { buildChallengeValue, CHALLENGE_COOKIE } from "./challenge-cookie.js";
import { registerPasswordEndpoints, type PasswordEndpointsDeps } from "./password-endpoints.js";

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
    setHeader(name: string, value: string | string[]): void {
      if (Array.isArray(value)) {
        state.headers[name] = value.join("\n");
        return;
      }
      state.headers[name] = value;
    },
    writeHead(status: number, headers?: Record<string, string>): ServerResponse {
      state.status = status;
      if (headers !== undefined) Object.assign(state.headers, headers);
      return res as unknown as ServerResponse;
    },
    end(body?: string): void {
      state.body = body ?? "";
    },
  };
  return Object.assign(state, { res: res as unknown as ServerResponse });
}

interface Harness {
  deps: PasswordEndpointsDeps;
  routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[];
  logs: { level: string; message: unknown }[];
  setBridge(bridge: ((host: string) => Promise<string | undefined>) | undefined): void;
}

function makeHarness(): Harness {
  const routes: Harness["routes"] = [];
  const logs: Harness["logs"] = [];
  let bridge: ((host: string) => Promise<string | undefined>) | undefined;
  const limiter = new LoginRateLimiter({ now: () => 1_000_000 });
  const table = new MemTable();
  return {
    routes,
    logs,
    setBridge: (value) => {
      bridge = value;
    },
    deps: {
      register: (route) => {
        routes.push(route);
        return () => {
          const at = routes.indexOf(route);
          if (at !== -1) routes.splice(at, 1);
        };
      },
      sessions: () => new SessionStore(table),
      cookieName: "dsh_auth",
      cookieSecure: false,
      sessionTtl: 604800,
      logoutOrder: 1000,
      usersPath: "/tmp/users.yaml",
      loadUsers: () =>
        Promise.resolve({
          snapshot: { users: new Map([["alice", { passwordHash: "h-alice", disabled: false }]]) },
          missing: false,
        }),
      verify: (password, storedHash) =>
        Promise.resolve(password === "pw" && storedHash === "h-alice"),
      totpMode: "off",
      verifyTotp: () => undefined,
      replayCheck: () => true,
      now: () => 1_700_000_000_000,
      challengeMacKey: Buffer.alloc(32, 7),
      launchTokenBridge: (host) =>
        bridge === undefined ? Promise.resolve(undefined) : bridge(host),
      limiter,
      logger: {
        error: (message) => logs.push({ level: "error", message }),
        info: (message) => logs.push({ level: "info", message }),
        warn: (message) => logs.push({ level: "warn", message }),
      },
    },
  };
}

function handlerOf(harness: Harness): HttpHandler {
  const route = harness.routes.find((r) => r.kind === "exact" && r.path === "/auth/login");
  if (route === undefined) throw new Error("route not found: exact /auth/login");
  return route.handler;
}

function loginReq(body: string, host = "", cookie = ""): IncomingMessage {
  return {
    method: "POST",
    url: "/auth/login",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(host === "" ? {} : { host }),
      ...(cookie === "" ? {} : { cookie }),
    },
    socket: { remoteAddress: "127.0.0.1" },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      yield Buffer.from(body);
    },
  } as unknown as IncomingMessage;
}

describe("POST /auth/login: launch-token bridge with TOTP two-step", () => {
  it("bridges on TOTP challenge submit", async () => {
    const harness = makeHarness();
    harness.deps.totpMode = "optional";
    harness.deps.verifyTotp = () => 42;
    harness.deps.loadUsers = () =>
      Promise.resolve({
        snapshot: {
          users: new Map([
            ["alice", { passwordHash: "h-alice", disabled: false, totpSecret: "ABC" }],
          ]),
        },
        missing: false,
      });
    harness.setBridge(() => Promise.resolve("http://dsh.test/?token=launch"));
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    const challenge = buildChallengeValue(
      "alice",
      harness.deps.now() + 60_000,
      harness.deps.challengeMacKey,
    );
    await handlerOf(harness)(
      loginReq(
        "username=alice&password=pw&code=123456&next=%2Fok",
        "dsh.test",
        `${CHALLENGE_COOKIE}=${challenge}`,
      ),
      res.res,
    );
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("http://dsh.test/?token=launch");
  });
});

describe("POST /auth/login: launch-token bridge (dsh 0.1.2-alpha token gate)", () => {
  it("redirects to the bridged authenticated URL when bridge returns one", async () => {
    const harness = makeHarness();
    harness.setBridge((host) => {
      expect(host).toBe("dsh.test");
      return Promise.resolve("http://dsh.test/?token=launch");
    });
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness)(
      loginReq("username=alice&password=pw&next=%2Fok", "dsh.test"),
      res.res,
    );
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("http://dsh.test/?token=launch");
    expect(harness.logs).toContainEqual({ level: "info", message: "session issued" });
  });

  it("falls back to next when the bridge returns undefined", async () => {
    const harness = makeHarness();
    harness.setBridge(() => Promise.resolve(undefined));
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness)(
      loginReq("username=alice&password=pw&next=%2Fok", "dsh.test"),
      res.res,
    );
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
  });

  it("falls back to next when the bridge throws (never blocks login)", async () => {
    const harness = makeHarness();
    harness.setBridge(() => Promise.reject(new Error("connection gone")));
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness)(
      loginReq("username=alice&password=pw&next=%2Fok", "dsh.test"),
      res.res,
    );
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(harness.logs).toContainEqual({
      level: "warn",
      message: "launch-token bridge failed; falling back to plain redirect",
    });
  });

  it("skips the bridge when the request has no Host header", async () => {
    const harness = makeHarness();
    const calls: string[] = [];
    harness.setBridge((host) => {
      calls.push(host);
      return Promise.resolve("http://dsh.test/?token=launch");
    });
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness)(loginReq("username=alice&password=pw&next=%2Fok"), res.res);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(calls).toEqual([]);
  });
});
