import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "../../gate/index.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { registerPasswordEndpoints, type PasswordEndpointsDeps } from "./password-endpoints.js";
import type { Session, SessionStore } from "../../session/index.js";

/**
 * P2 §1：`/auth/status` 的**加法扩展**形状矩阵（契约 §8-D 第 38 条）。
 * 与 `password-endpoints.status.test.ts`（P1 基线三例）分开，是为了守住两边的 max-lines。
 * 这里只伪造 `SessionStore.getByToken` 一个方法：被测的是 status 投影，不是会话存储。
 */

interface Stub {
  token: string;
  session: Session;
}

function fakeStore(rows: Stub[]): SessionStore {
  return {
    getByToken: (token: string) => rows.find((row) => row.token === token)?.session,
  } as unknown as SessionStore;
}

function session(kind?: "full" | "password-change-only"): Session {
  return {
    subject: "alice",
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    revoked: false,
    ...(kind === undefined ? {} : { kind }),
  };
}

function makeRes(): { res: ServerResponse; body: () => string } {
  let body = "";
  const res = {
    setHeader: (): void => undefined,
    writeHead: (): void => undefined,
    end: (chunk?: string): void => {
      body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return { res, body: () => body };
}

function handlerOf(deps: PasswordEndpointsDeps): HttpHandler {
  const routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[] = [];
  deps.register = (route) => {
    routes.push(route);
    return () => undefined;
  };
  registerPasswordEndpoints(deps);
  const route = routes.find((r) => r.path === "/auth/status");
  if (route === undefined) throw new Error("status route not registered");
  return route.handler;
}

function makeDeps(
  rows: Stub[],
  overrides: Partial<Pick<PasswordEndpointsDeps, "loadUsers">> = {},
  logs: unknown[] = [],
): PasswordEndpointsDeps {
  return {
    register: () => () => undefined,
    sessions: () => fakeStore(rows),
    cookieName: "dsh_auth",
    cookieSecure: false,
    sessionTtl: 604800,
    logoutOrder: 1000,
    usersPath: "/tmp/users.yaml",
    loadUsers:
      overrides.loadUsers ??
      (() => Promise.resolve({ snapshot: { users: new Map() }, missing: false })),
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
    logger: { info: (m) => logs.push(m), error: (m) => logs.push(m), warn: () => undefined },
  };
}

function statusReq(token: string | undefined): IncomingMessage {
  return {
    method: "GET",
    url: "/auth/status",
    headers: token === undefined ? {} : { cookie: `dsh_auth=${token}` },
    socket: {},
  } as unknown as IncomingMessage;
}

async function bodyFor(deps: PasswordEndpointsDeps, token: string | undefined): Promise<string> {
  const res = makeRes();
  await handlerOf(deps)(statusReq(token), res.res);
  return res.body();
}

const ALICE = { passwordHash: "h", disabled: false };

describe("GET /auth/status (P2 addition)", () => {
  it("appends exactly the six identity fields for an authenticated user", async () => {
    const deps = makeDeps([{ token: "good", session: session() }], {
      loadUsers: () =>
        Promise.resolve({
          snapshot: {
            users: new Map([
              [
                "alice",
                { ...ALICE, role: "admin", totpSecret: "S3CR3T", mustChangePassword: true },
              ],
            ]),
          },
          missing: false,
        }),
    });
    const body = JSON.parse(await bodyFor(deps, "good")) as Record<string, unknown>;
    expect(new Set(Object.keys(body))).toEqual(
      new Set([
        "authenticated",
        "logoutOrder",
        "name",
        "role",
        "disabled",
        "totpEnabled",
        "mustChangePassword",
        "sessionKind",
      ]),
    );
    expect(body).toMatchObject({
      authenticated: true,
      name: "alice",
      role: "admin",
      totpEnabled: true,
      mustChangePassword: true,
      sessionKind: "full",
    });
    expect(JSON.stringify(body)).not.toContain("S3CR3T");
  });

  it("reports the restricted kind straight from the session row", async () => {
    const deps = makeDeps([{ token: "restricted", session: session("password-change-only") }], {
      loadUsers: () =>
        Promise.resolve({ snapshot: { users: new Map([["alice", ALICE]]) }, missing: false }),
    });
    const body = JSON.parse(await bodyFor(deps, "restricted")) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "alice",
      role: "user",
      sessionKind: "password-change-only",
      mustChangePassword: false,
      totpEnabled: false,
    });
  });

  it("keeps exactly two keys for anonymous, unknown-subject and unreadable-users cases", async () => {
    const anonymous = makeDeps([]);
    expect(JSON.parse(await bodyFor(anonymous, undefined))).toEqual({
      authenticated: false,
      logoutOrder: 1000,
    });

    const unknown = makeDeps([{ token: "ghost", session: session() }]);
    expect(JSON.parse(await bodyFor(unknown, "ghost"))).toEqual({
      authenticated: true,
      logoutOrder: 1000,
    });

    const logs: unknown[] = [];
    const broken = makeDeps(
      [{ token: "good", session: session() }],
      {
        loadUsers: () => Promise.reject(new Error("boom")),
      },
      logs,
    );
    expect(JSON.parse(await bodyFor(broken, "good"))).toEqual({
      authenticated: true,
      logoutOrder: 1000,
    });
    expect(logs).toEqual(["status: users file unavailable: boom"]);
  });
});
