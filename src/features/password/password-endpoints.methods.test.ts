import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "../../gate/index.js";
import { passwordLoginPageHtml, LoginRateLimiter } from "../../shared/index.js";
import { registerPasswordEndpoints, type PasswordEndpointsDeps } from "./password-endpoints.js";

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

function makeReq(options: {
  method: string;
  url: string;
  contentType?: string;
  body?: Buffer;
}): IncomingMessage {
  return {
    method: options.method,
    url: options.url,
    headers: { "content-type": options.contentType },
    socket: { remoteAddress: "127.0.0.1" },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (options.body !== undefined) yield options.body;
    },
  } as unknown as IncomingMessage;
}

function makeDeps(): PasswordEndpointsDeps {
  return {
    register: () => () => undefined,
    sessions: () => undefined, // 本文件用例不走到会话分支（405/404/415/413/页面渲染提前短路）
    cookieName: "dsh_auth",
    cookieSecure: false,
    sessionTtl: 604800,
    logoutOrder: 1000,
    usersPath: "/tmp/users.yaml",
    loadUsers: () =>
      Promise.resolve({
        snapshot: { users: new Map([["alice", { passwordHash: "h", disabled: false }]]) },
        missing: false,
      }),
    verify: () => Promise.resolve(true),
    totpMode: "off",
    verifyTotp: () => undefined,
    replayCheck: () => true,
    now: () => 1_700_000_000_000,
    limiter: new LoginRateLimiter(),
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
  };
}

function registerAndGet(path: string): HttpHandler {
  const deps = makeDeps();
  const routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[] = [];
  deps.register = (route) => {
    routes.push(route);
    return () => undefined;
  };
  registerPasswordEndpoints(deps);
  const route = routes.find((r) => r.path === path);
  if (route === undefined) throw new Error(`route not found: ${path}`);
  return route.handler;
}

describe("method dispatch", () => {
  it("rejects DELETE /auth/login with 405 and allow header", async () => {
    const res = makeRes();
    await registerAndGet("/auth/login")(makeReq({ method: "DELETE", url: "/auth/login" }), res.res);
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET, POST");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("rejects GET /auth/logout with 405", async () => {
    const res = makeRes();
    await registerAndGet("/auth/logout")(makeReq({ method: "GET", url: "/auth/logout" }), res.res);
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
  });

  it("rejects POST /auth/status with 405", async () => {
    const res = makeRes();
    await registerAndGet("/auth/status")(makeReq({ method: "POST", url: "/auth/status" }), res.res);
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET");
  });
});

describe("prefix /auth fallback", () => {
  it("returns 404 for unregistered /auth/* paths instead of the SPA fallback", async () => {
    const res = makeRes();
    await registerAndGet("/auth")(makeReq({ method: "GET", url: "/auth/whatever" }), res.res);
    expect(res.status).toBe(404);
    expect(res.body).toBe("not found");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("POST /auth/login body errors", () => {
  it("rejects a non-urlencoded content type with 415", async () => {
    const res = makeRes();
    await registerAndGet("/auth/login")(
      makeReq({
        method: "POST",
        url: "/auth/login",
        contentType: "text/plain",
        body: Buffer.from("x"),
      }),
      res.res,
    );
    expect(res.status).toBe(415);
  });

  it("responds 413 with connection: close on an oversized body", async () => {
    const res = makeRes();
    await registerAndGet("/auth/login")(
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

describe("passwordLoginPageHtml", () => {
  it("escapes error text and renders the error paragraph", () => {
    const html = passwordLoginPageHtml("/", `bad <script> & "quotes"`);
    expect(html).toContain('<p class="error">bad &lt;script&gt; &amp; &quot;quotes&quot;</p>');
  });

  it("omits the error paragraph when no error is given", () => {
    expect(passwordLoginPageHtml("/")).not.toContain('class="error"');
  });

  it("escapes next in the hidden input", () => {
    expect(passwordLoginPageHtml(`/x?a=1&b=2`)).toContain('value="/x?a=1&amp;b=2"');
  });

  it("renders username and password fields with correct autocomplete", () => {
    const html = passwordLoginPageHtml("/");
    expect(html).toContain('name="username"');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('autocomplete="current-password"');
  });

  it("autofocuses only the password field (M3 P13)", () => {
    const html = passwordLoginPageHtml("/");
    expect(html).toContain(
      'autocomplete="current-password" placeholder="Enter your password" required autofocus>',
    );
    expect(html).not.toContain(
      'autocomplete="username" placeholder="Enter your username" required autofocus>',
    );
  });
});
