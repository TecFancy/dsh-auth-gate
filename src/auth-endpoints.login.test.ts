import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "./guard.js";
import { registerAuthEndpoints, type AuthEndpointsDeps } from "./auth-endpoints.js";
import { digestToken, SessionStore, type Session } from "./session-store.js";

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

function makeReq(options: {
  method?: string;
  url?: string;
  cookie?: string;
  authorization?: string;
  contentType?: string;
  body?: Buffer;
}): IncomingMessage {
  return {
    method: options.method ?? "GET",
    url: options.url ?? "/",
    headers: {
      cookie: options.cookie,
      authorization: options.authorization,
      "content-type": options.contentType,
    },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (options.body !== undefined) yield options.body;
    },
  } as unknown as IncomingMessage;
}

interface Harness {
  deps: AuthEndpointsDeps;
  routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[];
  table: MemTable;
  logs: { level: string; message: unknown }[];
  sessions(): SessionStore | undefined;
  setStore(value: SessionStore | undefined): void;
}

function makeHarness(options?: {
  sessionTtl?: number;
  cookieSecure?: boolean;
  logoutOrder?: number;
}): Harness {
  const routes: Harness["routes"] = [];
  const table = new MemTable();
  const logs: Harness["logs"] = [];
  let store: SessionStore | undefined = new SessionStore(table);
  return {
    routes,
    table,
    logs,
    sessions: () => store,
    setStore: (value) => {
      store = value;
    },
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
      cookieSecure: options?.cookieSecure ?? true,
      sessionTtl: options?.sessionTtl ?? 604800,
      logoutOrder: options?.logoutOrder ?? 1000,
      validateToken: (token) => Promise.resolve(token === "good-token"),
      logger: {
        error: (message) => logs.push({ level: "error", message }),
        info: (message) => logs.push({ level: "info", message }),
      },
    },
  };
}

function handlerOf(harness: Harness, kind: "exact" | "prefix", path: string): HttpHandler {
  const route = harness.routes.find((r) => r.kind === kind && r.path === path);
  if (route === undefined) throw new Error(`route not found: ${kind} ${path}`);
  return route.handler;
}

function loginReq(
  body: string,
  contentType = "application/x-www-form-urlencoded",
): IncomingMessage {
  return makeReq({ method: "POST", url: "/auth/login", contentType, body: Buffer.from(body) });
}

describe("POST /auth/login: success and rejection", () => {
  it("issues a session on a valid token", async () => {
    const harness = makeHarness({ cookieSecure: true });
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("token=good-token&next=%2Fok"), res.res);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(harness.table.size).toBe(1);
    const issuedToken = res.headers["set-cookie"]!.split(";")[0]!.split("=")[1]!;
    const issued = harness.table.get(digestToken(issuedToken))!;
    expect(issued.subject).toBe("token");
    expect(issued.expiresAt - issued.createdAt).toBe(604800 * 1000);
    expect(res.headers["set-cookie"]).toMatch(
      /^dsh_auth=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(harness.table.get(digestToken(issuedToken))?.subject).toBe("token");
    expect(harness.logs).toContainEqual({ level: "info", message: "session issued" });
  });

  it("omits Secure in the cookie when cookieSecure=false", async () => {
    const harness = makeHarness({ cookieSecure: false });
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=good-token"), res.res);
    expect(res.headers["set-cookie"]).toMatch(
      /^dsh_auth=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/,
    );
  });

  it("rejects an invalid token without creating a session", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=wrong&next=%2Fok"), res.res);
    expect(res.status).toBe(401);
    expect(res.body).toBe("invalid token");
    expect(harness.table.size).toBe(0);
    expect(harness.logs).toContainEqual({ level: "info", message: "login rejected" });
  });

  it("validates next: //evil.com and /auth/* fall back to /", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
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
      )(loginReq(`token=good-token&next=${encodeURIComponent(next)}`), res.res);
      expect(res.headers["location"]).toBe(expected);
    }
  });
});

describe("POST /auth/login: error paths", () => {
  it("returns 503 when the session store is unavailable", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    harness.setStore(undefined);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=good-token"), res.res);
    expect(res.status).toBe(503);
    expect(res.body).toBe("session store unavailable");
    expect(harness.logs).toContainEqual({
      level: "error",
      message: "login failed: session store unavailable",
    });
  });

  it("rejects a non-urlencoded content type with 415", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("token=good-token", "text/plain"), res.res);
    expect(res.status).toBe(415);
    expect(res.headers["content-type"]).toBe("text/plain");
  });

  it("responds 413 with connection: close on an oversized body", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(
      makeReq({
        method: "POST",
        url: "/auth/login",
        contentType: "application/x-www-form-urlencoded",
        body: Buffer.alloc(16 * 1024 + 1, 0x61),
      }),
      res.res,
    );
    expect(res.status).toBe(413);
    expect(res.headers["connection"]).toBe("close");
  });
});
