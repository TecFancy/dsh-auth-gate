/**
 * `POST/GET /auth/login` 端点的测试支撑（**只被测试 import，产品代码不引用**）。
 *
 * 从 `password-endpoints.login.test.ts` 抽出来是因为两个测试文件（登录主流程 + notice 白名单）
 * 都需要同一套 fake req/res 与 deps 装配，而单个测试文件有 250 有效行上限。
 */
import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpHandler } from "../../gate/index.js";
import type { PasswordEndpointsDeps } from "./password-endpoints.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { SessionStore, type Session } from "../../session/index.js";

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

export interface VerifyCall {
  storedHash: string;
  password: string;
}

export interface Harness {
  deps: PasswordEndpointsDeps;
  routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[];
  table: MemTable;
  logs: { level: string; message: unknown }[];
  verifyCalls: VerifyCall[];
  setStore(value: SessionStore | undefined): void;
  setUsers(users: Map<string, { passwordHash: string; disabled: boolean }>): void;
  setLoadError(error: Error): void;
  setMissing(): void;
  limiter: LoginRateLimiter;
}

export function makeHarness(): Harness {
  const routes: Harness["routes"] = [];
  const table = new MemTable();
  const logs: Harness["logs"] = [];
  const verifyCalls: VerifyCall[] = [];
  let store: SessionStore | undefined = new SessionStore(table);
  let users = new Map([["alice", { passwordHash: "h-alice", disabled: false }]]);
  let loadError: Error | undefined;
  let missing = false;
  const limiter = new LoginRateLimiter({ now: () => 1_000_000 });
  return {
    routes,
    table,
    logs,
    verifyCalls,
    setStore: (value) => {
      store = value;
    },
    setUsers: (value) => {
      users = value;
    },
    setLoadError: (error) => {
      loadError = error;
    },
    setMissing: () => {
      missing = true;
    },
    limiter,
    deps: {
      register: (route) => {
        routes.push(route);
        return () => {
          const at = routes.indexOf(route);
          if (at !== -1) routes.splice(at, 1);
        };
      },
      sessions: () => store,
      cookieName: "dsh_auth",
      cookieSecure: false,
      sessionTtl: 604800,
      logoutOrder: 1000,
      usersPath: "/tmp/users.yaml",
      loadUsers: () => {
        if (loadError !== undefined) return Promise.reject(loadError);
        const empty = new Map<string, { passwordHash: string; disabled: boolean }>();
        return Promise.resolve({ snapshot: { users: missing ? empty : users }, missing });
      },
      verify: (password, storedHash) => {
        verifyCalls.push({ storedHash, password });
        return Promise.resolve(password === "pw" && storedHash === "h-alice");
      },
      totpMode: "off",
      verifyTotp: () => undefined,
      replayCheck: () => true,
      now: () => 1_700_000_000_000,
      challengeMacKey: Buffer.alloc(32, 7), // D10 测试密钥
      limiter,
      logger: {
        error: (message) => logs.push({ level: "error", message }),
        info: (message) => logs.push({ level: "info", message }),
        warn: (message) => logs.push({ level: "warn", message }),
      },
    },
  };
}

export function handlerOf(harness: Harness, kind: "exact" | "prefix", path: string): HttpHandler {
  const route = harness.routes.find((r) => r.kind === kind && r.path === path);
  if (route === undefined) throw new Error(`route not found: ${kind} ${path}`);
  return route.handler;
}

export function loginReq(
  body: string,
  remoteAddress = "127.0.0.1",
  url = "/auth/login",
): IncomingMessage {
  return {
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    socket: { remoteAddress },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      yield Buffer.from(body);
    },
  } as unknown as IncomingMessage;
}

/** GET /auth/login 请求（无 body；notice 只可能出现在 query 上）。 */
export function loginGetReq(url: string, cookie?: string): IncomingMessage {
  return {
    method: "GET",
    url,
    headers: cookie === undefined ? {} : { cookie },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}
