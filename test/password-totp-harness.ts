import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpHandler } from "../src/gate/index.js";
import { LoginRateLimiter } from "../src/shared/index.js";
import {
  registerPasswordEndpoints,
  type PasswordEndpointsDeps,
} from "../src/features/password/password-endpoints.js";
import {
  buildChallengeValue,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
} from "../src/features/password/challenge-cookie.js";
import { SessionStore, type Session } from "../src/session/index.js";

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
  let headersSent = false;
  const res = {
    // 对齐 node:http：writeHead 之后再 setHeader 会抛 ERR_HTTP_HEADERS_SENT
    // （2026-09-22 线上同型故障：GET ?stage=password 清 cookie 时连接被重置）。
    setHeader: (name: string, value: string): void => {
      if (headersSent) throw new Error("ERR_HTTP_HEADERS_SENT: setHeader after writeHead");
      state.headers[name.toLowerCase()] = String(value);
    },
    writeHead: (status: number, extra?: Record<string, string | number>): void => {
      if (headersSent) throw new Error("ERR_HTTP_HEADERS_SENT: writeHead called twice");
      state.status = status;
      headersSent = true;
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

export function makeReq(options: {
  method?: string;
  url?: string;
  cookie?: string;
  body?: Buffer;
  /** 模拟反代改写后的 Host 头；缺省 = 不带 Host。 */
  host?: string;
}): IncomingMessage {
  return {
    method: options.method ?? "GET",
    url: options.url ?? "/",
    headers: {
      cookie: options.cookie,
      host: options.host,
      "content-type": "application/x-www-form-urlencoded",
    },
    socket: { remoteAddress: "127.0.0.1" },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (options.body !== undefined) yield options.body;
    },
  } as unknown as IncomingMessage;
}

export interface UserRec {
  passwordHash: string;
  totpSecret?: string;
  disabled: boolean;
}

export interface Harness {
  deps: PasswordEndpointsDeps;
  handlerOf(kind: "exact" | "prefix", path: string): HttpHandler;
  users: Map<string, UserRec>;
  setVerifyImpl(fn: (secret: string, code: string, nowMs: number) => number | undefined): void;
  nowMs: number;
  replayCalls: { username: string; counter: number; code: string }[];
  setReplayImpl(fn: (username: string, counter: number, code: string) => boolean): void;
  setStore(value: SessionStore | undefined): void;
  setTotpMode(mode: "off" | "optional" | "required"): void;
}

export const SECRET_ALICE = "JBSWY3DPEHPK3PXP"; // 常见 16 字符测试 secret（base32）

/** 测试用挑战 cookie HMAC 密钥（D10）：固定值，保证同一 harness 内签发/解析一致。 */
export const TEST_CHALLENGE_KEY = Buffer.alloc(32, 7);

export function makeHarness(): Harness {
  const routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[] = [];
  const table = new MemTable();
  const users = new Map<string, UserRec>([
    ["alice", { passwordHash: "h-alice", totpSecret: SECRET_ALICE, disabled: false }],
    ["bob", { passwordHash: "h-bob", disabled: false }],
  ]);
  const store = new SessionStore(table);
  let verifyImpl: (secret: string, code: string, nowMs: number) => number | undefined = () =>
    undefined;
  let replayImpl: (username: string, counter: number, code: string) => boolean = () => true;
  const replayCalls: Harness["replayCalls"] = [];
  let totpMode: "off" | "optional" | "required" = "optional";
  const nowMs = 1_700_000_000_000;
  const deps: PasswordEndpointsDeps = {
    register: (route) => {
      routes.push(route);
      return () => {
        const at = routes.indexOf(route);
        if (at !== -1) routes.splice(at, 1);
      };
    },
    sessions: () => storeRef,
    cookieName: "dsh_auth",
    cookieSecure: false,
    sessionTtl: 604800,
    logoutOrder: 1000,
    usersPath: "/tmp/users.yaml",
    loadUsers: () =>
      Promise.resolve({
        snapshot: { users: new Map(users) },
        missing: false,
      }),
    // 密码恒通过（storedHash 匹配任意测试用户 "h-*"）；正确性由既有 M3 测试覆盖
    verify: (password, storedHash) =>
      Promise.resolve(password === "pw" && storedHash.startsWith("h-")),
    limiter: new LoginRateLimiter(),
    totpMode: "optional",
    verifyTotp: (secret, code, nowMs) => verifyImpl(secret, code, nowMs),
    replayCheck: (username, counter, code) => {
      replayCalls.push({ username, counter, code });
      return replayImpl(username, counter, code);
    },
    now: () => nowMs,
    challengeMacKey: TEST_CHALLENGE_KEY,
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
  };
  deps.totpMode = totpMode; // 初始模式（setTotpMode 变更）
  let storeRef: SessionStore | undefined = store;
  registerPasswordEndpoints(deps); // 注册路由（M3 测试同款接线：先注册再取 handler）
  return {
    deps,
    users,
    setVerifyImpl: (fn) => {
      verifyImpl = fn;
    },
    nowMs,
    replayCalls,
    setReplayImpl: (fn) => {
      replayImpl = fn;
    },
    setStore: (value) => {
      storeRef = value;
    },
    setTotpMode: (mode) => {
      totpMode = mode;
      deps.totpMode = mode;
    },
    handlerOf: (kind, path) => {
      const route = routes.find((r) => r.kind === kind && r.path === path);
      if (route === undefined) throw new Error(`route not found: ${kind} ${path}`);
      return route.handler;
    },
  };
}

/** alice 的签名挑战 cookie（时钟原点 + TTL 内）。 */
export function aliceChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=${buildChallengeValue(
    "alice",
    1_700_000_000_000 + (CHALLENGE_TTL_SECONDS * 1000) / 2,
    TEST_CHALLENGE_KEY,
  )}`;
}

/** 一次请求直达响应的便捷封装（用例内省去 handler/res 样板）。 */
export async function post(
  h: Harness,
  method: "GET" | "POST",
  bodyOrCookie?: string,
  cookie?: string,
  /** 模拟反代改写后的 Host 头（D14 用例用它证明配置优先）。 */
  host?: string,
): Promise<FakeRes> {
  const res = makeRes();
  const withHost = host === undefined ? {} : { host };
  if (method === "GET") {
    const options = {
      method,
      ...(bodyOrCookie === undefined ? {} : { cookie: bodyOrCookie }),
      ...withHost,
    };
    await h.handlerOf("exact", "/auth/login")(makeReq(options), res.res);
    return res;
  }
  const base =
    bodyOrCookie === undefined ? { method } : { method, body: Buffer.from(bodyOrCookie) };
  const options = { ...base, ...(cookie === undefined ? {} : { cookie }), ...withHost };
  await h.handlerOf("exact", "/auth/login")(makeReq(options), res.res);
  return res;
}
