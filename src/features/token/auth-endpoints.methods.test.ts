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

function makeReq(options: { method?: string; url?: string; host?: string }): IncomingMessage {
  return {
    method: options.method ?? "GET",
    url: options.url ?? "/",
    headers: options.host === undefined ? {} : { host: options.host },
  } as unknown as IncomingMessage;
}

function makeHarness(publicHost?: string): {
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
      publicHost,
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
  it("escapes error text and renders the alert paragraph", () => {
    const html = loginPageHtml("/", `bad <script> & "quotes"`);
    expect(html).toContain(
      '<p class="error" id="err" role="alert">bad &lt;script&gt; &amp; &quot;quotes&quot;</p>',
    );
    expect(html).toContain('aria-invalid="true" aria-describedby="err"');
  });

  it("omits the error paragraph when no error is given", () => {
    const html = loginPageHtml("/");
    expect(html).not.toContain('class="error"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("escapes next in the hidden input", () => {
    expect(loginPageHtml(`/x?a=1&b=2`)).toContain('value="/x?a=1&amp;b=2"');
  });

  it("autofocuses the token input (M2 §4.4)", () => {
    const html = loginPageHtml("/");
    expect(html).toContain('id="token"');
    expect(html).toContain('name="token"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain("autofocus");
  });

  it("renders the identity block (kicker + host) and escapes the host", () => {
    const html = loginPageHtml("/", undefined, { host: `evil"><script>alert(1)</script>` });
    expect(html).toContain('<h1 class="kicker">Sign in</h1>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("caps the rendered host at 253 characters (visual truncation is CSS)", () => {
    const html = loginPageHtml("/", undefined, { host: "a".repeat(300) });
    expect(html).toContain(`title="${"a".repeat(253)}"`);
    expect(html).not.toContain("a".repeat(254));
  });

  it("omits the host line when no host is given", () => {
    expect(loginPageHtml("/")).not.toContain('class="host"');
  });
});

describe("publicHost (D14)", () => {
  it("falls back to the request Host header when publicHost is unset", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(makeReq({ url: "/auth/login?next=/", host: "dsh.example.com" }), res.res);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<p class="host" title="dsh.example.com" dir="ltr">');
    expect(res.body).toContain("dsh.example.com</p>");
  });

  it("prefers the configured publicHost over a rewritten request Host header", async () => {
    // 半外壳反代把 Host 改写成回环地址：身份块必须显示运营侧配置的对外域名。
    const harness = makeHarness("dsh.example.com");
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(makeReq({ url: "/auth/login?next=/", host: "127.0.0.1:3080" }), res.res);
    expect(res.body).toContain("dsh.example.com");
    expect(res.body).not.toContain("127.0.0.1:3080");
  });

  it("renders the configured publicHost even without a request Host header", async () => {
    const harness = makeHarness("dsh.example.com");
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(makeReq({ url: "/auth/login" }), res.res);
    expect(res.body).toContain('<p class="host" title="dsh.example.com"');
  });
});
