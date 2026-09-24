import type { IncomingMessage, ServerResponse } from "node:http";
import { LoginRateLimiter } from "../src/shared/index.js";
import type { UserRecord } from "../src/shared/index.js";
import type { Session, SessionStore } from "../src/session/index.js";
import {
  handlePasswordChange,
  type PasswordChangeDeps,
} from "../src/features/password/password-change.js";

/**
 * 改密端点的共享测试夹具（test/ 叶子，契约 §0 允许任何 slice 经相对路径引用）。
 * 覆盖：FakeRes（含 headersSent 语义）、请求构造、内存会话表、deps 装配与调用助手。
 */
export const CURRENT = "current-pw-1!";
export const NEW_PASSWORD = "NewPassw0rd!XY";
export const OLD_HASH = "scrypt$65536$8$1$old";
export const NEW_HASH = "scrypt$65536$8$1$new";
export const FIXED_NOW = 1_700_000_000_000;

export interface FakeRes {
  res: ServerResponse;
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

export function makeRes(): FakeRes {
  const state = {
    status: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: "",
  };
  let sent = false;
  const res = {
    // 对齐 node:http：writeHead 之后再 setHeader / writeHead 会抛 ERR_HTTP_HEADERS_SENT。
    setHeader: (name: string, value: string): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: setHeader after writeHead");
      state.headers[name.toLowerCase()] = String(value);
    },
    writeHead: (status: number, extra?: Record<string, string | number>): void => {
      if (sent) throw new Error("ERR_HTTP_HEADERS_SENT: writeHead called twice");
      state.status = status;
      sent = true;
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

export interface ReqOptions {
  method?: string;
  /** 缺省 = `dsh_auth=good`；`null` = 完全不带 Cookie 头；字符串 = 原样发送。 */
  cookie?: string | null;
  contentType?: string | undefined;
  body?: string | Buffer;
  /**
   * P2 §6：`/auth/password` 的 POST 有 Origin/Sec-Fetch-Site 门，缺省模拟浏览器同源请求。
   * `null` = 两个头都不带（用于断言 fail-closed 403；正例矩阵在
   * `src/features/password/password-change.origin.test.ts`）。
   */
  secFetchSite?: string | null;
}

export function makeReq(options: ReqOptions = {}): IncomingMessage {
  const cookie = options.cookie === undefined ? "dsh_auth=good" : options.cookie;
  const secFetchSite = options.secFetchSite === undefined ? "same-origin" : options.secFetchSite;
  return {
    method: options.method ?? "POST",
    url: "/auth/password",
    headers: {
      "content-type": options.contentType ?? "application/x-www-form-urlencoded",
      ...(cookie === null ? {} : { cookie }),
      ...(secFetchSite === null ? {} : { "sec-fetch-site": secFetchSite }),
    },
    socket: { remoteAddress: "127.0.0.1" },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (options.body !== undefined) yield Buffer.from(options.body);
    },
  } as unknown as IncomingMessage;
}

export function formBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

export const GOOD_BODY = formBody({ current: CURRENT, password: NEW_PASSWORD });

/** JSON.parse 返回 any：先落到 unknown 再断言（recommendedTypeChecked 禁 unsafe-argument）。 */
export function jsonBody(res: FakeRes): unknown {
  const parsed: unknown = JSON.parse(res.body);
  return parsed;
}

export function activeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    passwordHash: OLD_HASH,
    disabled: false,
    role: "user",
    mustChangePassword: false,
    ...overrides,
  };
}

interface SessionTable {
  store: SessionStore;
  has(token: string): boolean;
}

function makeStore(): SessionTable {
  const rows = new Map<string, Session>([
    [
      "good",
      { subject: "alice", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, revoked: false },
    ],
  ]);
  const store = {
    // 与真 SessionStore.getByToken 同语义：已吊销 / 已过期一律读不到。
    // （旧版只看 key 是否存在，会让"过期会话改密 401"这类用例静默假绿。）
    getByToken: (token: string): Session | undefined => {
      const row = rows.get(token);
      if (row === undefined || row.revoked || row.expiresAt <= Date.now()) return undefined;
      return row;
    },
    revokeBySubject: (subject: string): Promise<number> => {
      let count = 0;
      for (const [key, row] of rows) {
        if (row.subject !== subject) continue;
        rows.delete(key);
        count += 1;
      }
      return Promise.resolve(count);
    },
  } as unknown as SessionStore;
  return { store, has: (token) => rows.has(token) };
}

export interface Harness {
  deps: PasswordChangeDeps;
  store: SessionTable;
  users: Map<string, UserRecord>;
  state: { writes: number; revokes: number };
  logs: { level: string; message: unknown }[];
  limiter: LoginRateLimiter;
}

/** `user === null` = 用户不存在（未知用户路径）；缺省 = 启用中的 alice。 */
export function makeHarness(
  overrides: Partial<PasswordChangeDeps> = {},
  user: UserRecord | null = activeUser(),
): Harness {
  const store = makeStore();
  const users = new Map<string, UserRecord>();
  // 必须克隆：共享的 UserRecord 字面量会被上一个用例的写盘改脏。
  if (user !== null) users.set("alice", { ...user });
  const state = { writes: 0, revokes: 0 };
  const logs: { level: string; message: unknown }[] = [];
  const limiter = overrides.limiter ?? new LoginRateLimiter();
  const deps: PasswordChangeDeps = {
    sessions: () => store.store,
    cookieName: "dsh_auth",
    cookieSecure: false,
    usersPath: "/tmp/users.yaml",
    loadUsers: () => Promise.resolve({ snapshot: { users }, missing: false }),
    mutateUsers: async (mutator) => {
      await mutator({ users });
      state.writes += 1;
    },
    verify: (password) => Promise.resolve(password === CURRENT),
    hash: () => Promise.resolve(NEW_HASH),
    limiter,
    totpMode: "off",
    verifyTotp: () => undefined,
    replayCheck: () => true,
    revoke: (subject) => {
      state.revokes += 1;
      return store.store.revokeBySubject(subject).then(() => undefined);
    },
    now: () => FIXED_NOW,
    logger: {
      error: (message) => logs.push({ level: "error", message }),
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
    },
    ...overrides,
  };
  return { deps, store, users, state, logs, limiter };
}

export async function send(deps: PasswordChangeDeps, options: ReqOptions = {}): Promise<FakeRes> {
  const res = makeRes();
  await handlePasswordChange(deps, makeReq(options), res.res);
  return res;
}
