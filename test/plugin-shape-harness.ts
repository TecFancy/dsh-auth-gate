import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage } from "node:http";
import type {
  WrappableRoute,
  WrappableServer,
  WrappableUpgradeRoute,
} from "../src/host/shared/guard/index.js";
import type { AuthConfig } from "../src/index.js";

/**
 * `src/index.test.ts` 的装配夹具：配置默认值、假 webServer、假 cordis ctx 与几个小工具。
 *
 * 放在 `test/` 而不是 `src/` 里，是因为 `src/index.test.ts` 已经顶到 ESLint 的 250 行上限；
 * 本目录的 `*-harness.ts` 不被 vitest 收集、不编译进 `lib/`、也不进覆盖率。
 */

/** `installId` 是 volatile 盒子；同一引用让默认值断言不受函数身份影响。 */
export const INSTALL_ID = { get: () => "" };

/** 与 `Config({})` 的默认值逐字段对齐的配置对象。 */
export const cfg = (): AuthConfig => ({
  mode: "token",
  sessionTtl: 604800,
  cookieName: "dsh_auth",
  tokenRef: "DSH_AUTH_TOKEN",
  cookieSecure: true,
  usersFile: "",
  publicHost: "",
  clientIpHeader: "",
  trustedProxyCidrs: ["127.0.0.0/8", "::1/128"],
  revokeSweepMs: 5000,
  totp: "off",
  logoutOrder: 1000,
  passkey: "off",
  passkeyRpName: "DeepSeek Harness",
  passkeyRpId: "",
  passkeyOrigins: [],
  passkeyEnforceCounter: false,
  passkeyConditionalUi: false,
  telemetry: true,
  installId: INSTALL_ID,
});

/** 可观察的假 webServer（exact / prefix / upgrade / fallback 四类入口）。 */
export function makeFakeServer(): WrappableServer {
  const exact = new Map<string, WrappableRoute>();
  const prefixes = new Map<string, WrappableRoute>();
  const upgrades = new Map<string, WrappableUpgradeRoute>();
  const server: WrappableServer = {
    exact,
    prefixes,
    upgrades,
    fallback: undefined,
    register(route) {
      exact.set(route.path, route);
      return () => exact.delete(route.path);
    },
    registerUpgrade(route) {
      upgrades.set(route.path, route);
      return () => upgrades.delete(route.path);
    },
    registerFallback(handler) {
      server.fallback = handler;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

export interface FakeLog {
  level: string;
  message: unknown;
}

/** 假 cordis ctx：只实现 apply 会用到的方法，并记录 effect / provider / 日志。 */
export function makeCtx(
  server: WrappableServer | undefined,
  storageDomain: unknown,
  credentials?: unknown,
): {
  ctx: Context;
  effects: (() => unknown)[];
  logs: FakeLog[];
  provided: Record<string, unknown>;
} {
  const effects: (() => unknown)[] = [];
  const logs: FakeLog[] = [];
  const provided: Record<string, unknown> = {};
  const ctx = {
    get(serviceName: string): unknown {
      if (serviceName === "webServer") return server;
      if (serviceName === "storageDomain") return storageDomain;
      if (serviceName === "credentials") return credentials;
      return undefined;
    },
    provide(serviceName: string, value: unknown): void {
      provided[serviceName] = value;
    },
    logger(): {
      error(message: unknown): void;
      info(message: unknown): void;
      warn(message: unknown): void;
    } {
      return {
        error: (message) => logs.push({ level: "error", message }),
        info: (message) => logs.push({ level: "info", message }),
        warn: (message) => logs.push({ level: "warn", message }),
      };
    },
    effect(callback: () => unknown): void {
      const disposer = callback();
      if (typeof disposer === "function") effects.push(disposer as () => unknown);
    },
  } as unknown as Context;
  return { ctx, effects, logs, provided };
}

/** 把微任务/定时器推进一步（disposer 异步路径用）。 */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 带 Bearer 的请求（token 模式探针用）。 */
export function bearerReq(token: string): IncomingMessage {
  return { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
}

/** 日志里是否有一条包含 needle 的 error。 */
export function loggedError(logs: FakeLog[], needle: string): boolean {
  return logs.some((entry) => entry.level === "error" && String(entry.message).includes(needle));
}
