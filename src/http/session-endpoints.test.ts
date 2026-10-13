import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { Session, SessionStore } from "../session/index.js";
import { handleLogout, type AuthHttpDeps } from "./index.js";

/**
 * http/ 会话端点件的 logout 单元测试（经 barrel 取被测物）。
 * 纯 HTTP 件（404、405、query）在 `endpoints.test.ts`；`/auth/status` 的形状矩阵在
 * `session-endpoints.status.test.ts`（守 max-lines）。
 * 会话存储只伪造 logout 用到的两个方法：被测的是端点，不是存储。
 */

interface FakeRes {
  res: ServerResponse;
  status: number | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

/** 与真实 ServerResponse 一样：writeHead 之后再 setHeader / writeHead 会抛错。 */
function makeRes(): FakeRes {
  const state: Omit<FakeRes, "res"> = { status: undefined, headers: {}, body: undefined };
  let sent = false;
  const res = {
    setHeader: (name: string, value: string): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: setHeader after writeHead");
      state.headers[name.toLowerCase()] = String(value);
    },
    writeHead: (status: number, extra?: Record<string, string>): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: writeHead called twice");
      sent = true;
      state.status = status;
      for (const [name, value] of Object.entries(extra ?? {})) {
        state.headers[name.toLowerCase()] = value;
      }
    },
    end: (chunk?: string): void => {
      state.body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return Object.assign(state, { res });
}

function makeReq(method: string | undefined, url?: string, cookie?: string): IncomingMessage {
  return {
    method,
    url,
    headers: cookie === undefined ? {} : { cookie },
  } as unknown as IncomingMessage;
}

/** 只记录被吊销的 token；`known` 之外的 token 返回 false（与真实存储一致）。 */
function fakeStore(known: string[] = []): { store: SessionStore; revoked: string[] } {
  const revoked: string[] = [];
  const store = {
    getByToken: (): Session | undefined => undefined,
    revokeByToken: (token: string): Promise<boolean> => {
      revoked.push(token);
      return Promise.resolve(known.includes(token));
    },
  } as unknown as SessionStore;
  return { store, revoked };
}

function makeDeps(store: SessionStore | undefined, logs: unknown[] = []): AuthHttpDeps {
  return {
    sessions: () => store,
    cookieName: "dsh_auth",
    cookieSecure: false,
    logoutOrder: 1000,
    logger: { info: (message) => logs.push(message) },
  };
}

const CLEARED = "dsh_auth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax";

describe("handleLogout: method gate", () => {
  it("rejects non-POST with 405 Allow: POST and revokes nothing", () => {
    for (const method of ["GET", "HEAD", "DELETE", undefined]) {
      const { store, revoked } = fakeStore(["tok"]);
      const logs: unknown[] = [];
      const res = makeRes();
      const result = handleLogout(
        makeDeps(store, logs),
        makeReq(method, "/auth/logout", "dsh_auth=tok"),
        res.res,
      );
      expect(result).toBeUndefined();
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("POST");
      expect(revoked).toEqual([]);
      expect(logs).toEqual([]);
    }
  });
});

async function logout(
  deps: AuthHttpDeps,
  url: string | undefined,
  cookie?: string,
): Promise<FakeRes> {
  const res = makeRes();
  await handleLogout(deps, makeReq("POST", url, cookie), res.res);
  return res;
}

describe("handleLogout: POST", () => {
  it("revokes the cookie session, clears the cookie and redirects to /", async () => {
    const { store, revoked } = fakeStore(["tok"]);
    const logs: unknown[] = [];
    const res = await logout(makeDeps(store, logs), "/auth/logout", "a=1; dsh_auth=tok");
    expect(revoked).toEqual(["tok"]);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
    expect(res.headers["set-cookie"]).toBe(CLEARED);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe("");
    expect(logs).toEqual(["logout"]);
  });

  it("marks the cleared cookie Secure when cookieSecure is on", async () => {
    const deps = { ...makeDeps(fakeStore().store), cookieSecure: true };
    const res = await logout(deps, "/auth/logout");
    expect(res.headers["set-cookie"]).toBe(
      "dsh_auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("redirects to a safe relative next taken from the query", async () => {
    const res = await logout(makeDeps(fakeStore().store), "/auth/logout?next=%2Fchat%3Fa%3D1");
    expect(res.headers["location"]).toBe("/chat?a=1");
  });

  it("falls back to / for an unsafe, looping or missing next", async () => {
    const unsafe = ["https://evil.example/", "//evil.example/", "/\\evil", "/\t/evil", ""];
    for (const next of [...unsafe, "/auth", "/auth/login"]) {
      const url = `/auth/logout?next=${encodeURIComponent(next)}`;
      const res = await logout(makeDeps(fakeStore().store), url);
      expect(res.headers["location"]).toBe("/");
    }
    expect((await logout(makeDeps(fakeStore().store), undefined)).headers["location"]).toBe("/");
  });

  it("succeeds silently when there is no cookie, an empty one, or an unknown session", async () => {
    for (const cookie of [undefined, "dsh_auth=", "other=tok", "dsh_auth=gone"]) {
      const { store, revoked } = fakeStore();
      const res = await logout(makeDeps(store), "/auth/logout", cookie);
      expect(res.status).toBe(302);
      expect(res.headers["set-cookie"]).toBe(CLEARED);
      expect(revoked).toEqual(cookie === "dsh_auth=gone" ? ["gone"] : []);
    }
  });

  it("still clears the cookie when the session channel is unavailable", async () => {
    const logs: unknown[] = [];
    const res = await logout(makeDeps(undefined, logs), "/auth/logout", "dsh_auth=tok");
    expect(res.status).toBe(302);
    expect(res.headers["set-cookie"]).toBe(CLEARED);
    expect(logs).toEqual(["logout"]);
  });

  it("propagates a revoke failure without writing a response", async () => {
    const store = {
      revokeByToken: () => Promise.reject(new Error("disk full")),
    } as unknown as SessionStore;
    const res = makeRes();
    await expect(
      handleLogout(makeDeps(store), makeReq("POST", "/auth/logout", "dsh_auth=tok"), res.res),
    ).rejects.toThrow("disk full");
    expect(res.status).toBeUndefined();
  });
});
