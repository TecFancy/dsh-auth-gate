import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { Session, SessionStore } from "../session/index.js";
import type { UserRecord, UsersLoadResult } from "../shared/index.js";
import { handleStatus, type AuthHttpDeps } from "./index.js";

/**
 * `handleStatus` 直测（不经任何 features/ 的路由注册）：方法门、会话判定、
 * 「关于我」投影与三条硬边界（只含关于我、键集合相等、读盘失败不 500）。
 * 会话存储只伪造 `getByToken`：被测的是 status 投影，不是存储。
 */

interface Captured {
  res: ServerResponse;
  status: () => number | undefined;
  headers: Record<string, string>;
  json: () => Record<string, unknown>;
}

function makeRes(): Captured {
  let status: number | undefined;
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string): void => {
      headers[name.toLowerCase()] = value;
    },
    writeHead: (code: number, extra?: Record<string, string>): void => {
      status = code;
      Object.assign(headers, extra);
    },
    end: (chunk?: string): void => {
      body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    headers,
    json: () => JSON.parse(body) as Record<string, unknown>,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return { subject: "alice", createdAt: 0, expiresAt: 1, revoked: false, ...overrides };
}

function storeWith(rows: Record<string, Session>): SessionStore {
  return { getByToken: (token: string) => rows[token] } as unknown as SessionStore;
}

function usersOf(entries: Record<string, UserRecord>): () => Promise<UsersLoadResult> {
  return () =>
    Promise.resolve({ snapshot: { users: new Map(Object.entries(entries)) }, missing: false });
}

interface DepsOptions {
  store?: SessionStore | undefined;
  loadUsers?: AuthHttpDeps["loadUsers"];
  errors?: unknown[] | undefined;
}

function makeDeps(options: DepsOptions = {}): AuthHttpDeps {
  const errors = options.errors;
  return {
    sessions: () => ("store" in options ? options.store : storeWith({ good: session() })),
    cookieName: "dsh_auth",
    cookieSecure: false,
    logoutOrder: 42,
    loadUsers: options.loadUsers,
    logger: {
      info: () => undefined,
      ...(errors === undefined ? {} : { error: (message: unknown) => errors.push(message) }),
    },
  };
}

function statusReq(cookie?: string, method = "GET"): IncomingMessage {
  return {
    method,
    url: "/auth/status",
    headers: cookie === undefined ? {} : { cookie },
  } as unknown as IncomingMessage;
}

async function status(deps: AuthHttpDeps, cookie?: string): Promise<Captured> {
  const res = makeRes();
  await handleStatus(deps, statusReq(cookie), res.res);
  return res;
}

const ALICE: UserRecord = { passwordHash: "h", disabled: false };

describe("handleStatus: method gate", () => {
  it("rejects non-GET with 405 Allow: GET", () => {
    for (const method of ["POST", "HEAD", "PUT"]) {
      const res = makeRes();
      const result = handleStatus(makeDeps(), statusReq("dsh_auth=good", method), res.res);
      expect(result).toBeUndefined();
      expect(res.status()).toBe(405);
      expect(res.headers["allow"]).toBe("GET");
    }
  });
});

describe("handleStatus: session check (token mode, no loadUsers)", () => {
  it("reports an authenticated cookie session with the two base fields only", async () => {
    const res = await status(makeDeps(), "x=1; dsh_auth=good");
    expect(res.status()).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({ authenticated: true, logoutOrder: 42 });
  });

  it("reports unauthenticated for a missing, empty, foreign or unknown cookie", async () => {
    for (const cookie of [undefined, "dsh_auth=", "other=good", "dsh_auth=bad"]) {
      const res = await status(makeDeps(), cookie);
      expect(res.status()).toBe(200);
      expect(res.json()).toEqual({ authenticated: false, logoutOrder: 42 });
    }
  });

  it("reports unauthenticated when the session channel is unavailable", async () => {
    const res = await status(makeDeps({ store: undefined }), "dsh_auth=good");
    expect(res.json()).toEqual({ authenticated: false, logoutOrder: 42 });
  });

  it("answers synchronously when it does not read users", () => {
    const res = makeRes();
    expect(handleStatus(makeDeps(), statusReq("dsh_auth=good"), res.res)).toBeUndefined();
    expect(res.status()).toBe(200);
  });
});

describe("handleStatus: identity fields (password mode)", () => {
  it("never reads users for an unauthenticated request", async () => {
    let reads = 0;
    const loadUsers = (): Promise<UsersLoadResult> => {
      reads += 1;
      return usersOf({ alice: ALICE })();
    };
    const res = await status(makeDeps({ loadUsers }), "dsh_auth=bad");
    expect(res.json()).toEqual({ authenticated: false, logoutOrder: 42 });
    expect(reads).toBe(0);
  });

  it("fills defaults for a plain user on a legacy session row", async () => {
    const res = await status(makeDeps({ loadUsers: usersOf({ alice: ALICE }) }), "dsh_auth=good");
    expect(res.json()).toEqual({
      authenticated: true,
      name: "alice",
      role: "user",
      disabled: false,
      totpEnabled: false,
      mustChangePassword: false,
      sessionKind: "full",
      logoutOrder: 42,
    });
  });

  it("projects role, totp, must-change and session kind as stored", async () => {
    const store = storeWith({ good: session({ kind: "password-change-only" }) });
    const admin: UserRecord = {
      passwordHash: "h",
      disabled: true,
      role: "admin",
      totpSecret: "JBSWY3DPEHPK3PXP",
      mustChangePassword: true,
    };
    const res = await status(
      makeDeps({ store, loadUsers: usersOf({ alice: admin }) }),
      "dsh_auth=good",
    );
    expect(res.json()).toMatchObject({
      role: "admin",
      disabled: true,
      totpEnabled: true,
      mustChangePassword: true,
      sessionKind: "password-change-only",
    });
  });

  it("exposes only the caller's own record, never other users", async () => {
    const loadUsers = usersOf({ alice: ALICE, bob: { ...ALICE, role: "admin" } });
    const body = JSON.stringify((await status(makeDeps({ loadUsers }), "dsh_auth=good")).json());
    expect(body).not.toContain("bob");
    expect(body).not.toContain("admin");
  });

  it("keeps the two base fields when the subject is no longer in users", async () => {
    const res = await status(makeDeps({ loadUsers: usersOf({ bob: ALICE }) }), "dsh_auth=good");
    expect(res.json()).toEqual({ authenticated: true, logoutOrder: 42 });
  });
});

describe("handleStatus: users file unavailable", () => {
  it("keeps the two base fields and logs the error message", async () => {
    const errors: unknown[] = [];
    const loadUsers = (): Promise<UsersLoadResult> => Promise.reject(new Error("bad yaml"));
    const res = await status(makeDeps({ loadUsers, errors }), "dsh_auth=good");
    expect(res.status()).toBe(200);
    expect(res.json()).toEqual({ authenticated: true, logoutOrder: 42 });
    expect(errors).toEqual(["status: users file unavailable: bad yaml"]);
  });

  it("stringifies a non-Error rejection", async () => {
    const errors: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- 被测分支就是非 Error 拒因
    const loadUsers = (): Promise<UsersLoadResult> => Promise.reject("EACCES");
    await status(makeDeps({ loadUsers, errors }), "dsh_auth=good");
    expect(errors).toEqual(["status: users file unavailable: EACCES"]);
  });

  it("tolerates a logger without error()", async () => {
    const loadUsers = (): Promise<UsersLoadResult> => Promise.reject(new Error("gone"));
    const res = await status(makeDeps({ loadUsers }), "dsh_auth=good");
    expect(res.json()).toEqual({ authenticated: true, logoutOrder: 42 });
  });
});
