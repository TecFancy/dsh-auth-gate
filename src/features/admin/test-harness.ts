import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LoginRateLimiter } from "../../shared/index.js";
import type { UserRecord } from "../../shared/index.js";
import { digestToken, SessionStore, type Session } from "../../session/index.js";
import type { AdminAuditEvent } from "./audit.js";
import type { AdminDeps } from "./deps.js";

/**
 * admin 切片测试夹具（切片内，非 *.test.ts）。依赖全部可注入 + 真实 `SessionStore`（内存表），
 * 会话定位/吊销走真实实现；`mutateUsers` 默认打内存 map，需要真文件时由用例覆盖。
 */
export class MemTable implements KvTable<string, Session> {
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
  /** 缺省 = `dsh_auth=admin`；`null` = 不带 Cookie 头。 */
  cookie?: string | null;
  contentType?: string | null;
  body?: string | Buffer;
  origin?: string | null;
  secFetchSite?: string | null;
  host?: string;
  encrypted?: boolean;
}

export function makeReq(options: ReqOptions = {}): IncomingMessage {
  const cookie = options.cookie === undefined ? "dsh_auth=admin" : options.cookie;
  const contentType =
    options.contentType === undefined ? "application/x-www-form-urlencoded" : options.contentType;
  return {
    method: options.method ?? "POST",
    url: "/auth/users/password",
    headers: {
      ...(contentType === null ? {} : { "content-type": contentType }),
      ...(cookie === null ? {} : { cookie }),
      ...(options.origin === undefined || options.origin === null
        ? {}
        : { origin: options.origin }),
      ...(options.secFetchSite === undefined || options.secFetchSite === null
        ? {}
        : { "sec-fetch-site": options.secFetchSite }),
      ...(options.host === undefined ? {} : { host: options.host }),
    },
    socket: { remoteAddress: "127.0.0.1", encrypted: options.encrypted === true },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (options.body !== undefined) yield Buffer.from(options.body);
    },
  } as unknown as IncomingMessage;
}

export function form(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

/** JSON.parse 返回 any：先落 unknown 再断言（recommendedTypeChecked 禁 unsafe-argument）。 */
export function jsonBody(res: FakeRes): unknown {
  const parsed: unknown = JSON.parse(res.body);
  return parsed;
}

export function adminUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return { passwordHash: "hash-old", disabled: false, role: "admin", ...overrides };
}

export function session(subject: string, kind?: Session["kind"]): Session {
  return { subject, createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, revoked: false, kind };
}

export interface Harness {
  deps: AdminDeps;
  store: SessionStore;
  users: Map<string, UserRecord>;
  sessions: Map<string, Session>;
  logs: { level: string; message: unknown }[];
  revokes: string[];
  cleared: string[];
  hashCalls: string[];
  totpCalls: string[];
  readonly loadCalls: number;
  limiter: LoginRateLimiter;
  /** 审计事件（logger 入参里带 `event` 字符串的那些）。 */
  audits(): AdminAuditEvent[];
}

interface Counters {
  logs: { level: string; message: unknown }[];
  revokes: string[];
  cleared: string[];
  hashCalls: string[];
  totpCalls: string[];
  loadCalls: number;
}

function seedUsers(): Map<string, UserRecord> {
  return new Map<string, UserRecord>([
    ["admin", adminUser()],
    ["totpadmin", adminUser({ totpSecret: "TOTP-SECRET" })],
    ["alice", { passwordHash: "hash-alice", disabled: false, role: "user" }],
  ]);
}

function seedSessions(table: MemTable): Map<string, Session> {
  // 键 = 原始会话 token（cookie 值），表键 = digest(token)：与 SessionStore.getByToken 对齐。
  const sessions = new Map<string, Session>([
    ["admin", session("admin")],
    ["alice", session("alice")],
    ["totpadmin", session("totpadmin")],
    ["restricted", session("admin", "password-change-only")],
  ]);
  // 落盘键 = digest(raw token)（SessionStore.getByToken 按 digest 查表，见 M1）。
  for (const [token, value] of sessions) void table.put(digestToken(token), value);
  return sessions;
}

function buildDeps(
  counters: Counters,
  users: Map<string, UserRecord>,
  sessions: Map<string, Session>,
  store: SessionStore,
  overrides: Partial<AdminDeps>,
): AdminDeps {
  return {
    sessions: () => store,
    cookieName: "dsh_auth",
    loadUsers: () => {
      counters.loadCalls += 1;
      return Promise.resolve({ users });
    },
    mutateUsers: async (mutator) => {
      await mutator({ users });
    },
    hash: (password) => {
      counters.hashCalls.push(password);
      return Promise.resolve(`scrypt$stub$${password.length}`);
    },
    verify: (password, hash) => Promise.resolve(hash === "hash-old" && password === "old-pw-1!"),
    verifyTotp: (secret, code) => {
      counters.totpCalls.push(code);
      return code === "123456" && secret !== "" ? 7 : undefined;
    },
    replayCheck: () => true,
    clientIp: () => "127.0.0.1",
    publicHost: "dsh.example.com",
    limiter: new LoginRateLimiter(),
    revokeSubject: async (subject) => {
      counters.revokes.push(subject);
      for (const [token, value] of sessions) {
        if (value.subject === subject) sessions.delete(token);
      }
      // 真实 API：按 row.subject 全表扫描删除（覆盖测试侧直接 create 出来的会话）。
      await store.revokeBySubject(subject);
      return true;
    },
    clearRateBuckets: (subject) => counters.cleared.push(subject),
    now: () => 1_700_000_000_000,
    logger: {
      info: (message) => counters.logs.push({ level: "info", message }),
      error: (message) => counters.logs.push({ level: "error", message }),
    },
    ...overrides,
  };
}

/** 审计事件筛选：logger 入参里 `event` 以 `audit.` 开头的对象。 */
function collectAudits(logs: { message: unknown }[]): AdminAuditEvent[] {
  const events: AdminAuditEvent[] = [];
  for (const entry of logs) {
    const message = entry.message;
    if (typeof message !== "object" || message === null || !("event" in message)) continue;
    const event = (message as AdminAuditEvent).event;
    if (typeof event === "string" && event.startsWith("audit.")) {
      events.push(message as AdminAuditEvent);
    }
  }
  return events;
}

export function makeHarness(overrides: Partial<AdminDeps> = {}): Harness {
  const table = new MemTable();
  const store = new SessionStore(table);
  const counters: Counters = {
    logs: [],
    revokes: [],
    cleared: [],
    hashCalls: [],
    totpCalls: [],
    loadCalls: 0,
  };
  const users = seedUsers();
  const sessions = seedSessions(table);
  const deps = buildDeps(counters, users, sessions, store, overrides);
  return {
    deps,
    store,
    users,
    sessions,
    logs: counters.logs,
    revokes: counters.revokes,
    cleared: counters.cleared,
    hashCalls: counters.hashCalls,
    totpCalls: counters.totpCalls,
    get loadCalls(): number {
      return counters.loadCalls;
    },
    limiter: deps.limiter,
    audits: () => collectAudits(counters.logs),
  };
}
