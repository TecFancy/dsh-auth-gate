import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  guardHttp,
  guardUpgrade,
  wrapServer,
  type HttpHandler,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "../../gate/index.js";
import { makeHarness, makeRes, post, sessionToken } from "../../../test/password-totp-harness.js";
import { PasswordGate } from "./password-gate.js";

function req(headers: Record<string, string>, method = "GET", url = "/"): IncomingMessage {
  return { method, url, headers } as unknown as IncomingMessage;
}

function fakeSocket(): { socket: Duplex; state: { written: string; destroyed: boolean } } {
  const state = { written: "", destroyed: false };
  const socket = {
    write: (data: string): void => {
      state.written = String(data);
    },
    destroy: (): void => {
      state.destroyed = true;
    },
  } as unknown as Duplex;
  return { socket, state };
}

function fakeServer(): WrappableServer {
  const exact = new Map<string, WrappableRoute>();
  const prefixes = new Map<string, WrappableRoute>();
  const upgrades = new Map<string, WrappableUpgradeRoute>();
  const server: WrappableServer = {
    exact,
    prefixes,
    upgrades,
    fallback: undefined,
    register(route) {
      exact.set(route.path, route);
      return () => exact.delete(route.path);
    },
    registerUpgrade(route) {
      upgrades.set(route.path, route);
      return () => upgrades.delete(route.path);
    },
    registerFallback(handler) {
      server.fallback = handler;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

/** 走真实登录 handler 拿一枚受限会话（bob 无 TOTP；标记来自 users 记录）。 */
async function restrictedLogin(): Promise<{ gate: PasswordGate; cookie: string }> {
  const h = makeHarness();
  h.users.get("bob")!.mustChangePassword = true;
  const login = await post(h, "POST", "username=bob&password=pw&next=%2Ffoo");
  expect(login.headers["location"]).toBe("/auth/password");
  return {
    gate: new PasswordGate({ sessions: () => h.storeOf(), cookieName: "dsh_auth" }),
    cookie: `dsh_auth=${sessionToken(login.headers)}`,
  };
}

describe("受限会话的宿主可达性（验收 23/24，生产渲染路径）", () => {
  it("denies fallback host paths: navigation 302 /auth/password, API/静态//plugins 401", async () => {
    const { gate, cookie } = await restrictedLogin();
    let called = 0;
    const guarded = guardHttp(
      () => gate,
      "fallback",
      () => {
        called += 1;
      },
    );

    const nav = makeRes();
    await guarded(req({ cookie, "sec-fetch-mode": "navigate" }, "GET", "/api/x"), nav.res);
    expect(nav.status).toBe(302);
    expect(nav.headers["location"]).toBe("/auth/password");

    for (const path of ["/api/x", "/plugins/x.js", "/manifest.webmanifest", "/assets/index.js"]) {
      const res = makeRes();
      await guarded(req({ cookie, accept: "application/json" }, "GET", path), res.res);
      expect(res.status).toBe(401);
      expect(res.body).toBe("unauthorized");
    }
    expect(called).toBe(0);
  });

  it("routes /auth/users* to the handler (gate must not 302) and rejects the WS handshake", async () => {
    const { gate, cookie } = await restrictedLogin();
    let reached = 0;
    const users: HttpHandler = (_request, res) => {
      reached += 1;
      // 管理面 handler 的真实 403 属 admin-api 切片；此处只证明 gate 不拦截、不 302。
      res.writeHead(403, { "content-type": "application/json" });
      res.end('{"error":"forbidden"}');
    };
    const guarded = guardHttp(() => gate, "exact", users);
    const res = makeRes();
    await guarded(req({ cookie, "sec-fetch-mode": "navigate" }, "GET", "/auth/users"), res.res);
    expect(reached).toBe(1);
    expect(res.status).toBe(403);
    expect(res.headers["location"]).toBeUndefined();

    let upgraded = false;
    const upgrade = guardUpgrade(
      () => gate,
      () => {
        upgraded = true;
      },
    );
    const { socket, state } = fakeSocket();
    await upgrade(req({ cookie }, "GET", "/api/events.host"), socket, Buffer.alloc(0));
    expect(state.written).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
    expect(state.destroyed).toBe(true);
    expect(upgraded).toBe(false);
  });
});

describe("受限会话：wrapServer 全入口类（验收 23）", () => {
  it("keeps the wrapServer entry classes guarded (存量 exact + upgrade)", async () => {
    const { gate, cookie } = await restrictedLogin();
    const server = fakeServer();
    let reached = 0;
    server.exact.set("/probe", {
      kind: "exact",
      path: "/probe",
      handler: () => {
        reached += 1;
      },
    });
    server.upgrades.set("/api/events.host", {
      path: "/api/events.host",
      handler: () => {
        reached += 1;
      },
    });
    wrapServer(server, () => gate, { error: () => undefined });

    const nav = makeRes();
    await server.exact
      .get("/probe")!
      .handler(req({ cookie, "sec-fetch-mode": "navigate" }, "GET", "/probe"), nav.res);
    expect(nav.status).toBe(302);
    expect(nav.headers["location"]).toBe("/auth/password");

    const { socket, state } = fakeSocket();
    await server.upgrades
      .get("/api/events.host")!
      .handler(req({ cookie }, "GET", "/api/events.host"), socket, Buffer.alloc(0));
    expect(state.destroyed).toBe(true);
    expect(reached).toBe(0);
  });
});

describe("受限会话的登出与吊销（验收 25/26/31，真实 handler）", () => {
  it("allows POST /auth/logout and it takes effect (换人闭环)", async () => {
    const h = makeHarness();
    h.users.get("bob")!.mustChangePassword = true;
    const login = await post(h, "POST", "username=bob&password=pw");
    const token = sessionToken(login.headers);
    const store = h.storeOf()!;
    const gate = new PasswordGate({ sessions: () => h.storeOf(), cookieName: "dsh_auth" });

    const res = makeRes();
    await guardHttp(
      () => gate,
      "exact",
      h.handlerOf("exact", "/auth/logout"),
    )(req({ cookie: `dsh_auth=${token}` }, "POST", "/auth/logout"), res.res);
    expect(res.status).toBe(302);
    expect(res.headers["set-cookie"]).toContain("dsh_auth=; Max-Age=0");
    expect(store.getByToken(token)).toBeUndefined();

    const after = makeRes();
    await guardHttp(
      () => gate,
      "fallback",
      () => {
        throw new Error("host handler must not run after logout");
      },
    )(req({ cookie: `dsh_auth=${token}` }, "GET", "/api/x"), after.res);
    expect(after.status).toBe(401);
  });

  it("reports unauthenticated via /auth/status once the subject is revoked (改密全踢)", async () => {
    const h = makeHarness();
    h.users.get("bob")!.mustChangePassword = true;
    const login = await post(h, "POST", "username=bob&password=pw");
    const token = sessionToken(login.headers);
    const gate = new PasswordGate({ sessions: () => h.storeOf(), cookieName: "dsh_auth" });

    // password-change.ts 改密成功后的全踢（含当前受限会话）；gate 只信 store。
    await h.storeOf()!.revokeBySubject("bob");

    const res = makeRes();
    await guardHttp(
      () => gate,
      "exact",
      h.handlerOf("exact", "/auth/status"),
    )(req({ cookie: `dsh_auth=${token}` }, "GET", "/auth/status"), res.res);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ authenticated: false, logoutOrder: 1000 });
  });
});

describe("受限会话身份投影（验收 20/21，/auth/status 追加字段）", () => {
  it("reports sessionKind/mustChangePassword for marked vs unmarked users", async () => {
    const marked = makeHarness();
    marked.users.get("bob")!.mustChangePassword = true;
    const login = await post(marked, "POST", "username=bob&password=pw");
    const token = sessionToken(login.headers);
    const gate = new PasswordGate({ sessions: () => marked.storeOf(), cookieName: "dsh_auth" });
    const res = makeRes();
    await guardHttp(
      () => gate,
      "exact",
      marked.handlerOf("exact", "/auth/status"),
    )(req({ cookie: `dsh_auth=${token}` }, "GET", "/auth/status"), res.res);
    expect(JSON.parse(res.body)).toMatchObject({
      authenticated: true,
      sessionKind: "password-change-only",
      mustChangePassword: true,
    });

    const plain = makeHarness();
    const fullLogin = await post(plain, "POST", "username=bob&password=pw");
    const fullGate = new PasswordGate({ sessions: () => plain.storeOf(), cookieName: "dsh_auth" });
    const fullRes = makeRes();
    await guardHttp(
      () => fullGate,
      "exact",
      plain.handlerOf("exact", "/auth/status"),
    )(
      req({ cookie: `dsh_auth=${sessionToken(fullLogin.headers)}` }, "GET", "/auth/status"),
      fullRes.res,
    );
    expect(JSON.parse(fullRes.body)).toMatchObject({
      authenticated: true,
      sessionKind: "full",
      mustChangePassword: false,
    });
  });
});
