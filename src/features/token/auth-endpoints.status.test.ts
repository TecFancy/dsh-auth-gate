import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { type HttpHandler } from "../../gate/index.js";
import { registerAuthEndpoints, type AuthEndpointsDeps } from "./auth-endpoints.js";
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

describe("GET /auth/status", () => {
  it("reports authentication from the session cookie only", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const issued = await harness.sessions()!.create("token", 60_000);

    const authed = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/status",
    )(makeReq({ cookie: `dsh_auth=${issued.token}` }), authed.res);
    expect(authed.status).toBe(200);
    expect(authed.body).toBe('{"authenticated":true,"logoutOrder":1000}');

    const anonymous = makeRes();
    await handlerOf(harness, "exact", "/auth/status")(makeReq({}), anonymous.res);
    expect(anonymous.body).toBe('{"authenticated":false,"logoutOrder":1000}');

    const bearerOnly = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/status",
    )(makeReq({ authorization: "Bearer good-token" }), bearerOnly.res);
    expect(bearerOnly.body).toBe('{"authenticated":false,"logoutOrder":1000}');
  });

  it("echoes the configured logoutOrder for the client logout CTA", async () => {
    const harness = makeHarness({ logoutOrder: 5000 });
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/status")(makeReq({}), res.res);
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"authenticated":false,"logoutOrder":5000}');
  });
});
