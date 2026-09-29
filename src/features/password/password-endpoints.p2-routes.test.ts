import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "../../gate/index.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { registerPasswordEndpoints, type PasswordEndpointsDeps } from "./password-endpoints.js";
import type { SessionStore } from "../../session/index.js";

/**
 * 路由快照（契约 §1 / CONTRACT-tests 36、37）：**1 prefix + 6 exact**（P2），
 * 管理路由是接线式 opt-in（缺省不注册），token 模式走 `registerAuthEndpoints` 不受影响。
 * 方法矩阵（`405` + `allow`）逐条锁死：webserver 没有 method 路由，全部由 handler 分发。
 */

interface Route {
  kind: "exact" | "prefix";
  path: string;
  handler: HttpHandler;
}

function makeDeps(): { deps: PasswordEndpointsDeps; routes: Route[] } {
  const routes: Route[] = [];
  const handler: HttpHandler = (_req, res) => {
    res.writeHead(200);
    res.end("ok");
  };
  return {
    routes,
    deps: {
      register: (route) => {
        routes.push(route);
        return () => undefined;
      },
      sessions: () => undefined as SessionStore | undefined,
      cookieName: "dsh_auth",
      cookieSecure: false,
      sessionTtl: 604800,
      usersPath: "/tmp/users.yaml",
      loadUsers: () => Promise.resolve({ snapshot: { users: new Map() }, missing: false }),
      publicHost: "https://dsh.example.test",
      verify: () => Promise.resolve(false),
      limiter: new LoginRateLimiter(),
      clientIp: () => "127.0.0.1",
      totpMode: "off",
      verifyTotp: () => undefined,
      replayCheck: () => true,
      now: () => 1_700_000_000_000,
      challengeMacKey: Buffer.alloc(32, 7),
      launchTokenBridge: () => Promise.resolve(undefined),
      logoutOrder: 1000,
      logger: { info: () => undefined, error: () => undefined, warn: () => undefined },
      passwordChange: {
        mutateUsers: () => Promise.resolve(),
        hash: () => Promise.resolve("h"),
        limiter: new LoginRateLimiter(),
        replayCheck: () => true,
        revoke: () => Promise.resolve(),
      },
      admin: { users: handler, resetPassword: handler },
    },
  };
}

function fakeRes(): {
  res: ServerResponse;
  status: () => number | undefined;
  allow: () => string | undefined;
} {
  const state: { status?: number; headers: Record<string, string> } = { headers: {} };
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
    end: (): void => undefined,
  } as unknown as ServerResponse;
  return { res, status: () => state.status, allow: () => state.headers["allow"] };
}

function req(method: string, url: string): IncomingMessage {
  return { method, url, headers: {}, socket: {} } as unknown as IncomingMessage;
}

function handlerOf(routes: Route[], path: string): HttpHandler {
  const route = routes.find((r) => r.kind === "exact" && r.path === path);
  if (route === undefined) throw new Error(`route not found: ${path}`);
  return route.handler;
}

describe("P2 route table", () => {
  it("registers 1 prefix + 6 exact routes with the admin wiring in place", () => {
    const { deps, routes } = makeDeps();
    registerPasswordEndpoints(deps);
    expect(routes.filter((route) => route.kind === "prefix").map((route) => route.path)).toEqual([
      "/auth",
    ]);
    expect(routes.filter((route) => route.kind === "exact").map((route) => route.path)).toEqual([
      "/auth/login",
      "/auth/logout",
      "/auth/status",
      "/auth/password",
      "/auth/users",
      "/auth/users/password",
    ]);
  });

  it("keeps the admin routes opt-in (incremental wiring, no silent registration)", () => {
    const { deps, routes } = makeDeps();
    delete deps.admin;
    registerPasswordEndpoints(deps);
    expect(routes.some((route) => route.path.startsWith("/auth/users"))).toBe(false);
    expect(routes.filter((route) => route.kind === "exact")).toHaveLength(4);
  });

  it("locks the per-route method matrix (405 + allow) for the password-mode routes", async () => {
    const { deps, routes } = makeDeps();
    registerPasswordEndpoints(deps);
    // 两条管理路由的 405/allow 由 `src/features/admin` 的 handler 决定，这里注入的是桩；
    // 它们的真值断言在 `src/integration.p2-admin.test.ts`（真 handler、真 HTTP 栈）。
    const cases: [string, string, string][] = [
      ["/auth/login", "PUT", "GET, POST"],
      ["/auth/logout", "GET", "POST"],
      ["/auth/status", "POST", "GET"],
      ["/auth/password", "DELETE", "GET, POST"],
    ];
    for (const [path, method, allow] of cases) {
      const res = fakeRes();
      await handlerOf(routes, path)(req(method, path), res.res);
      expect([path, res.status(), res.allow()]).toEqual([path, 405, allow]);
    }
  });
});
