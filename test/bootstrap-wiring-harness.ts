import type { Context } from "@deepseek-ai/cordis";
import type {
  HttpHandler,
  WrappableRoute,
  WrappableServer,
} from "../src/host/shared/guard/index.js";
import { SessionStore } from "../src/host/entities/session/index.js";
import { SETUP_PATH } from "../src/host/shared/protocol/index.js";
import { makeBootstrapWiring, type BootstrapWiringInput } from "../src/bootstrap-wiring.js";
import { fakeReq, makeRes, MemTable } from "./bootstrap-harness.js";

/**
 * `bootstrap-wiring.test.ts` 的夹具：假 webServer 路由表 + 假 Context（credentials /
 * connection）+ 真 `SessionStore`。不碰网络，也不碰真实 DSH_HOME。
 */

export const LAUNCH = "launch-token";
export const FORM = "application/x-www-form-urlencoded";
export const LOGIN_REDIRECT = "/auth/login?next=%2F";

export interface Credentials {
  resolve(ref: string): Promise<{ value: string } | undefined>;
  set?(ref: string, value: string): Promise<void>;
}

type FakeServer = WrappableServer & { routes: Map<string, WrappableRoute> };

function makeServer(): FakeServer {
  const routes = new Map<string, WrappableRoute>();
  return {
    routes,
    exact: routes,
    prefixes: new Map(),
    upgrades: new Map(),
    fallback: undefined,
    register(route: WrappableRoute) {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
    registerUpgrade: () => () => undefined,
    registerFallback: () => () => undefined,
  };
}

/** 只回答 credentials / connection 的假 Context；其余服务一律不存在。 */
function makeCtx(credentials: Credentials | undefined): Context {
  return {
    get: (name: string) => {
      if (name === "credentials") return credentials;
      if (name === "connection") {
        return { authenticatedUrl: () => `http://dsh.example.com/?token=${LAUNCH}` };
      }
      return undefined;
    },
  } as Context;
}

export interface WiringHarness {
  wiring: ReturnType<typeof makeBootstrapWiring>;
  server: FakeServer;
  store: SessionStore;
  logs: { level: string; message: unknown }[];
  handler(path: string): HttpHandler;
  cookie(kind?: "bootstrap" | "full"): Promise<string>;
  /** POST `/auth/setup`（同源、urlencoded），返回假响应。 */
  post(body?: string, session?: Promise<string>): Promise<ReturnType<typeof makeRes>>;
}

export function makeWiringHarness(
  options: {
    mode?: "token" | "password";
    credentials?: Credentials;
    usersPath?: string;
    mount?: boolean;
    tokenRef?: string;
  } = {},
): WiringHarness {
  const mode = options.mode ?? "token";
  const credentials = options.credentials;
  const server = makeServer();
  const store = new SessionStore(new MemTable());
  const logs: { level: string; message: unknown }[] = [];
  const input: BootstrapWiringInput = {
    ctx: makeCtx(credentials),
    server,
    config: {
      mode,
      cookieName: "dsh_auth",
      cookieSecure: false,
      sessionTtl: 3600,
      tokenRef: options.tokenRef ?? "DSH_AUTH_TOKEN",
      publicHost: "dsh.example.com",
    },
    auth: { sessions: store },
    usersPath: options.usersPath ?? "/tmp/dsh-auth-wiring/users.yaml",
    launchTokenBridge: () => Promise.resolve(`/?token=${LAUNCH}`),
    log: {
      error: (message) => logs.push({ level: "error", message }),
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
    },
  };
  const wiring = makeBootstrapWiring(input);
  if (options.mount !== false) wiring.mount();
  const cookie = async (kind: "bootstrap" | "full" = "bootstrap"): Promise<string> => {
    const issued = await store.create(kind, 60_000, kind);
    return `dsh_auth=${issued.token}`;
  };
  return {
    wiring,
    server,
    store,
    logs,
    handler: (path) => server.routes.get(path)!.handler,
    cookie,
    async post(body = "", session?: Promise<string>): Promise<ReturnType<typeof makeRes>> {
      const res = makeRes();
      await server.routes.get(SETUP_PATH)!.handler(
        fakeReq({
          method: "POST",
          url: SETUP_PATH,
          cookie: session === undefined ? await cookie() : await session,
          headers: { "sec-fetch-site": "same-origin" },
          contentType: FORM,
          body,
        }),
        res.res,
      );
      return res;
    },
  };
}
