import type { IncomingMessage, ServerResponse } from "node:http";
import { MemTable, makeRes } from "./token-endpoints-harness.js";
import { SessionStore } from "../src/host/entities/session/index.js";
import type { SessionKind } from "../src/host/shared/protocol/index.js";
import {
  makeSetupHandlers,
  type ConfiguredProbe,
  type ConfiguredState,
  type SetupEndpointDeps,
  type SetupTokenOutcome,
} from "../src/host/features/bootstrap/index.js";

/**
 * 首次引导功能片段的单元夹具：假请求、假探针、可定制的 setup deps，加一个真的
 * `SessionStore`（MemTable 之上，与生产同一份实现）。
 * 不是 `.test.ts`，所以 vitest 不收集它。
 */
export { MemTable, makeRes } from "./token-endpoints-harness.js";
export type { FakeRes } from "./token-endpoints-harness.js";

export interface FakeRequestOptions {
  method?: string;
  url?: string;
  cookie?: string;
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
}

/** 假请求：url/method/headers 齐全，body 走 iterator（`parseFormBody` 要读它）。 */
export function fakeReq(options: FakeRequestOptions = {}): IncomingMessage {
  const body = options.body;
  return {
    method: options.method ?? "GET",
    url: options.url ?? "/",
    socket: {},
    headers: {
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.contentType === undefined ? {} : { "content-type": options.contentType }),
      ...options.headers,
    },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (body !== undefined) yield Buffer.from(body);
    },
  } as unknown as IncomingMessage;
}

/** 固定（或按次计算）结论的探针。 */
export function probeOf(
  state: ConfiguredState | (() => Promise<ConfiguredState>),
): ConfiguredProbe {
  return {
    state: () => Promise.resolve(typeof state === "function" ? state() : state),
    markConfigured: () => undefined,
  };
}

/** 建一枚会话并回传可直接塞进 Cookie 头的值。 */
export async function cookieFor(
  store: SessionStore,
  cookieName = "dsh_auth",
  kind: SessionKind = "bootstrap",
): Promise<string> {
  const issued = await store.create(kind, 60_000, kind);
  return `${cookieName}=${issued.token}`;
}

export interface SetupHarnessOptions {
  mode?: "token" | "password";
  /** 未配置探针的结论（默认未配置）。 */
  probe?: ConfiguredProbe;
  saveToken?: () => Promise<SetupTokenOutcome>;
  createAdmin?: (
    username: string,
    password: string,
  ) => Promise<"ok" | "conflict" | "invalid" | "failed">;
  publicHost?: string;
  sessionTtlSeconds?: number;
  store?: SessionStore | undefined;
}

export interface SetupHarness {
  deps: SetupEndpointDeps;
  store: SessionStore;
  /** 每次 `issueFullSession` 收到的 subject（顺序即调用顺序）。 */
  issued: string[];
  logs: { level: string; message: unknown }[];
  cookie(kind?: SessionKind): Promise<string>;
}

/** setup 端点的默认 deps：token 模式能一次成功，password 模式能建号成功。 */
export function makeSetupHarness(options: SetupHarnessOptions = {}): SetupHarness {
  const store = options.store ?? new SessionStore(new MemTable());
  const issued: string[] = [];
  const logs: { level: string; message: unknown }[] = [];
  const deps: SetupEndpointDeps = {
    mode: options.mode ?? "token",
    probe: options.probe ?? probeOf("unconfigured"),
    sessions: () => store,
    cookieName: "dsh_auth",
    cookieSecure: false,
    sessionTtlSeconds: options.sessionTtlSeconds ?? 604800,
    publicHost: options.publicHost ?? "dsh.example.com",
    tokenRef: "DSH_AUTH_TOKEN",
    usersPath: "/tmp/dsh-auth-test/users.yaml",
    saveToken:
      options.saveToken ?? (() => Promise.resolve({ status: "saved", token: "new-token" })),
    createAdmin: options.createAdmin ?? (() => Promise.resolve("ok")),
    issueFullSession: (subject, res) => {
      issued.push(subject);
      res.setHeader("set-cookie", "dsh_auth=full-session; Max-Age=604800; Path=/; HttpOnly");
      return Promise.resolve();
    },
    logger: {
      error: (message) => logs.push({ level: "error", message }),
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
    },
  };
  return { deps, store, issued, logs, cookie: (kind) => cookieFor(store, "dsh_auth", kind) };
}

/** setup 端点的两个处理函数（测试里省掉把 deps 再包一层的样板）。 */
export interface SetupHandlers {
  get: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  post: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

/** GET 向导页：返回假响应（状态/头/体）。 */
export async function getSetupPage(
  harness: SetupHarness,
  cookie?: string,
): Promise<ReturnType<typeof makeRes>> {
  const res = makeRes();
  await makeSetupHandlers(harness.deps).get(
    fakeReq({ url: "/auth/setup", ...(cookie === undefined ? {} : { cookie }) }),
    res.res,
  );
  return res;
}

/**
 * POST 向导表单。`headers` 缺省带同源凭据（`sec-fetch-site`）；`method` 固定 POST，
 * `contentType` 缺省 urlencoded，`form === false` 时给一个非表单类型（415 用）。
 */
export async function postSetupForm(
  harness: SetupHarness,
  options: {
    cookie?: string;
    headers?: Record<string, string>;
    body?: string;
    form?: boolean;
    contentType?: string;
  } = {},
): Promise<ReturnType<typeof makeRes>> {
  const res = makeRes();
  await makeSetupHandlers(harness.deps).post(
    fakeReq({
      method: "POST",
      url: "/auth/setup",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      headers: options.headers ?? { "sec-fetch-site": "same-origin" },
      contentType:
        options.contentType ??
        (options.form === false ? "application/json" : "application/x-www-form-urlencoded"),
      ...(options.body === undefined ? {} : { body: options.body }),
    }),
    res.res,
  );
  return res;
}
