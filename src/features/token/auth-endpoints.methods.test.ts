import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { registerAuthEndpoints, type AuthEndpointsDeps } from "./auth-endpoints.js";
import { loginPageHtml } from "../../shared/index.js";
import { SessionStore, type Session } from "../../session/index.js";
import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { HttpHandler } from "../../gate/index.js";

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

function makeReq(options: { method?: string; url?: string }): IncomingMessage {
  return {
    method: options.method ?? "GET",
    url: options.url ?? "/",
    headers: {},
  } as unknown as IncomingMessage;
}

function makeHarness(): {
  deps: AuthEndpointsDeps;
  routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[];
} {
  const routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[] = [];
  return {
    routes,
    deps: {
      register: (route) => {
        routes.push(route);
        return () => {
          const at = routes.indexOf(route);
          if (at !== -1) routes.splice(at, 1);
        };
      },
      sessions: () => new SessionStore(new MemTable()),
      cookieName: "dsh_auth",
      cookieSecure: true,
      sessionTtl: 604800,
      logoutOrder: 1000,
      validateToken: (token) => Promise.resolve(token === "good-token"),
      logger: {
        error: () => undefined,
        info: () => undefined,
      },
    },
  };
}

function handlerOf(
  harness: ReturnType<typeof makeHarness>,
  kind: "exact" | "prefix",
  path: string,
): HttpHandler {
  const route = harness.routes.find((r) => r.kind === kind && r.path === path);
  if (route === undefined) throw new Error(`route not found: ${kind} ${path}`);
  return route.handler;
}

describe("method dispatch", () => {
  it("rejects unsupported methods with 405 and an allow header", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const cases: [string, string, string][] = [
      ["DELETE", "/auth/login", "GET, POST"],
      ["GET", "/auth/logout", "POST"],
      ["POST", "/auth/status", "GET"],
    ];
    for (const [method, path, allow] of cases) {
      const res = makeRes();
      await handlerOf(harness, "exact", path)(makeReq({ method, url: path }), res.res);
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(res.headers["allow"]).toBe(allow);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });
});

describe("prefix catch-all", () => {
  it("answers every unregistered /auth/* path with 404 from the catch-all", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "prefix", "/auth")(makeReq({ url: "/auth/whatever" }), res.res);
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("loginPageHtml", () => {
  it("escapes error text and renders the error paragraph", () => {
    const html = loginPageHtml("/", `bad <script> & "quotes"`);
    expect(html).toContain('<p class="error">bad &lt;script&gt; &amp; &quot;quotes&quot;</p>');
  });

  it("omits the error paragraph when no error is given", () => {
    expect(loginPageHtml("/")).not.toContain('class="error"');
  });

  it("escapes next in the hidden input", () => {
    expect(loginPageHtml(`/x?a=1&b=2`)).toContain('value="/x?a=1&amp;b=2"');
  });

  it("autofocuses the token input (M2 §4.4)", () => {
    expect(loginPageHtml("/")).toContain(
      'autocomplete="current-password" placeholder="Paste your token" required autofocus>',
    );
  });
});
