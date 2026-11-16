/**
 * `handleStatus` 直测的共享夹具（**只被测试 import，产品代码不引用**）。
 *
 * 从 `session-endpoints.status.test.ts` 抽出来，是因为「会话判定 + 关于我投影」与
 * 「passkeyEnabled / passwordLoginDisabled 两个配置透传位」两组用例合起来超过 250 行上限，
 * 而两边需要同一套假 res、假 store 与 deps 装配。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Session, SessionStore } from "../src/host/entities/session/model/session-store.js";
import type { UsersLoadResult } from "../src/host/entities/user/@x/session.js";
import {
  handleStatus,
  type AuthHttpDeps,
} from "../src/host/entities/session/api/session-endpoints.js";

/** One `users.yaml` entry, derived from the only user type the session entity may see. */
export type UserRecord =
  UsersLoadResult["snapshot"]["users"] extends Map<string, infer Record> ? Record : never;

export interface Captured {
  res: ServerResponse;
  status: () => number | undefined;
  headers: Record<string, string>;
  json: () => Record<string, unknown>;
}

export function makeRes(): Captured {
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

export function session(overrides: Partial<Session> = {}): Session {
  return { subject: "alice", createdAt: 0, expiresAt: 1, revoked: false, ...overrides };
}

export function storeWith(rows: Record<string, Session>): SessionStore {
  return { getByToken: (token: string) => rows[token] } as unknown as SessionStore;
}

export function usersOf(entries: Record<string, UserRecord>): () => Promise<UsersLoadResult> {
  return () =>
    Promise.resolve({ snapshot: { users: new Map(Object.entries(entries)) }, missing: false });
}

export interface DepsOptions {
  store?: SessionStore | undefined;
  loadUsers?: AuthHttpDeps["loadUsers"];
  passkeyEnabled?: boolean | undefined;
  passwordLoginDisabled?: boolean | undefined;
  errors?: unknown[] | undefined;
}

export function makeDeps(options: DepsOptions = {}): AuthHttpDeps {
  const errors = options.errors;
  return {
    sessions: () => ("store" in options ? options.store : storeWith({ good: session() })),
    cookieName: "dsh_auth",
    cookieSecure: false,
    logoutOrder: 42,
    passkeyEnabled: options.passkeyEnabled,
    passwordLoginDisabled: options.passwordLoginDisabled,
    loadUsers: options.loadUsers,
    logger: {
      info: () => undefined,
      ...(errors === undefined ? {} : { error: (message: unknown) => errors.push(message) }),
    },
  };
}

export function statusReq(cookie?: string, method = "GET"): IncomingMessage {
  return {
    method,
    url: "/auth/status",
    headers: cookie === undefined ? {} : { cookie },
  } as unknown as IncomingMessage;
}

export async function status(deps: AuthHttpDeps, cookie?: string): Promise<Captured> {
  const res = makeRes();
  await handleStatus(deps, statusReq(cookie), res.res);
  return res;
}
