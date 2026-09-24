import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "../../shared/index.js";
import type { UserRecord } from "../../shared/index.js";
import type { HttpHandler } from "../../gate/index.js";
import type { Session, SessionStore } from "../../session/index.js";
import {
  registerPasswordEndpoints,
  type PasswordChangeWiring,
  type PasswordEndpointsDeps,
} from "./password-endpoints.js";

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
  let sent = false;
  const res = {
    setHeader: (name: string, value: string): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: setHeader after writeHead");
      state.headers[name.toLowerCase()] = String(value);
    },
    writeHead: (status: number, extra?: Record<string, string | number>): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: writeHead called twice");
      state.status = status;
      sent = true;
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

function makeReq(method: string, cookie: string | null, body: string): IncomingMessage {
  return {
    method,
    url: "/auth/password",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie === null ? {} : { cookie }),
    },
    socket: { remoteAddress: "127.0.0.1" },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      yield Buffer.from(body);
    },
  } as unknown as IncomingMessage;
}

interface Captured {
  deps: PasswordEndpointsDeps;
  routes: { kind: string; path: string; handler: HttpHandler }[];
  users: Map<string, UserRecord>;
  revoked: string[];
  loginLimiter: LoginRateLimiter;
  changeLimiter: LoginRateLimiter;
}

function makeDeps(withWiring: boolean): Captured {
  const routes: { kind: string; path: string; handler: HttpHandler }[] = [];
  const revoked: string[] = [];
  const users = new Map<string, UserRecord>([
    [
      "alice",
      { passwordHash: "old-hash", disabled: false, role: "user", mustChangePassword: false },
    ],
  ]);
  const rows = new Map<string, Session>([
    [
      "good",
      { subject: "alice", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, revoked: false },
    ],
  ]);
  const store = { getByToken: (token: string): Session | undefined => rows.get(token) };
  const loginLimiter = new LoginRateLimiter();
  const changeLimiter = new LoginRateLimiter();
  const wiring: PasswordChangeWiring = {
    mutateUsers: async (mutator) => {
      await mutator({ users });
    },
    hash: () => Promise.resolve("new-hash"),
    limiter: changeLimiter,
    replayCheck: () => true,
    revoke: (subject) => {
      revoked.push(subject);
      return Promise.resolve();
    },
  };
  const deps: PasswordEndpointsDeps = {
    register: (route) => {
      routes.push(route);
      return () => undefined;
    },
    sessions: () => store as unknown as SessionStore,
    cookieName: "dsh_auth",
    cookieSecure: false,
    sessionTtl: 604800,
    usersPath: "/tmp/users.yaml",
    loadUsers: () => Promise.resolve({ snapshot: { users }, missing: false }),
    verify: (password) => Promise.resolve(password === "current-pw-1!"),
    limiter: loginLimiter,
    totpMode: "off",
    verifyTotp: () => undefined,
    replayCheck: () => true,
    now: () => 1_700_000_000_000,
    challengeMacKey: Buffer.alloc(32, 7),
    logoutOrder: 1000,
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
    ...(withWiring ? { passwordChange: wiring } : {}),
  };
  return { deps, routes, users, revoked, loginLimiter, changeLimiter };
}

function routeOf(captured: Captured): HttpHandler {
  const route = captured.routes.find((r) => r.path === "/auth/password");
  if (route === undefined) throw new Error("route /auth/password is not registered");
  return route.handler;
}

const BODY = "current=current-pw-1!&password=NewPassw0rd!XY";

describe("route /auth/password registration (anti-regression, §1)", () => {
  it("registers nothing without the wiring (additive public surface)", () => {
    const captured = makeDeps(false);
    registerPasswordEndpoints(captured.deps);
    const exact = captured.routes.filter((route) => route.kind === "exact").map((r) => r.path);
    expect(exact).toEqual(["/auth/login", "/auth/logout", "/auth/status"]);
    expect(captured.routes.some((route) => route.path === "/auth/password")).toBe(false);
  });

  it("registers the 4th exact route when the wiring is passed (1 prefix + 4 exact)", () => {
    const captured = makeDeps(true);
    registerPasswordEndpoints(captured.deps);
    const exact = captured.routes.filter((route) => route.kind === "exact").map((r) => r.path);
    expect(exact).toEqual(["/auth/login", "/auth/logout", "/auth/status", "/auth/password"]);
    expect(captured.routes.filter((route) => route.kind === "prefix").map((r) => r.path)).toEqual([
      "/auth",
    ]);
  });

  it("answers 405 + allow: POST on a non-POST method (thin delegation)", async () => {
    const captured = makeDeps(true);
    registerPasswordEndpoints(captured.deps);
    const res = makeRes();
    await routeOf(captured)(makeReq("GET", "dsh_auth=good", ""), res.res);
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("performs the change through the registered route with the injected wiring", async () => {
    const captured = makeDeps(true);
    registerPasswordEndpoints(captured.deps);
    const res = makeRes();
    await routeOf(captured)(makeReq("POST", "dsh_auth=good", BODY), res.res);
    expect(res.status).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true }));
    expect(captured.users.get("alice")?.passwordHash).toBe("new-hash");
    expect(captured.revoked).toEqual(["alice"]);
    expect(res.headers["set-cookie"]).toContain("dsh_auth=; Max-Age=0");
  });

  it("keys the injected change limiter, never the login limiter", async () => {
    const captured = makeDeps(true);
    registerPasswordEndpoints(captured.deps);
    const bad = "current=wrong&password=NewPassw0rd!XY";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = makeRes();
      await routeOf(captured)(makeReq("POST", "dsh_auth=good", bad), res.res);
      expect(res.status).toBe(401);
    }
    const res = makeRes();
    await routeOf(captured)(makeReq("POST", "dsh_auth=good", BODY), res.res);
    expect(res.status).toBe(429);
    expect(captured.changeLimiter.check("127.0.0.1", "alice").allowed).toBe(false);
    expect(captured.loginLimiter.check("127.0.0.1", "alice").allowed).toBe(true);
  });
});
