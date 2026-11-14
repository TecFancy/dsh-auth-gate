/**
 * `apply` 的匿名统计接线：只在请求被门放行之后上报，启动时一次都不发，关掉后一个请求都不发。
 *
 * 这是把 `shared/telemetry` 接进真实入口路径的那几行；模块自己的契约边界在
 * `src/host/shared/telemetry/telemetry.test.ts` 里覆盖，这里只钉住"接在哪、什么时候第一次触发"。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bodyOf, flush } from "../test/telemetry-harness.js";
import {
  isGuarded,
  type HttpHandler,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./host/shared/guard/index.js";
import type { VolatileField } from "./host/shared/telemetry/index.js";
import { apply, type AuthConfig } from "./index.js";

const INSTALL_ID: VolatileField<string> = { get: () => "" };

function makeFakeServer(): WrappableServer {
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

function makeCtx(server: WrappableServer, settings: unknown): Context {
  return {
    get(serviceName: string): unknown {
      if (serviceName === "webServer") return server;
      if (serviceName === "settings") return settings;
      if (serviceName === "credentials") {
        return { resolve: () => Promise.resolve({ value: "good-token", source: "test" }) };
      }
      return undefined;
    },
    provide(): void {
      // 测试不读 auth 服务本身。
    },
    logger(): {
      error(message: unknown): void;
      info(message: unknown): void;
      warn(message: unknown): void;
    } {
      return { error: () => undefined, info: () => undefined, warn: () => undefined };
    },
    effect(callback: () => unknown): void {
      callback();
    },
  } as unknown as Context;
}

function cfg(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
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
    ...overrides,
  };
}

function makeReq(): IncomingMessage {
  return {
    url: "/probe",
    method: "GET",
    headers: { authorization: "Bearer good-token" },
  } as unknown as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {
    headersSent: false,
    setHeader: () => undefined,
    writeHead: () => undefined,
    end: () => undefined,
  } as unknown as ServerResponse;
}

/** 装一个探针路由。 */
function mountProbe(server: WrappableServer): void {
  server.exact.set("/probe", { kind: "exact", path: "/probe", handler: () => undefined });
}

/** apply 之后表里的探针 handler（已被守卫包过）。 */
function probeHandler(server: WrappableServer): HttpHandler {
  const route = server.exact.get("/probe");
  if (route?.handler === undefined) throw new Error("probe handler missing");
  return route.handler;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apply: 匿名统计接线", () => {
  it("starts nothing at startup, then pings once after an admitted request", async () => {
    const server = makeFakeServer();
    const writes: { namespace: string; patch: object }[] = [];
    const settings = {
      update: (namespace: string, patch: object) => {
        writes.push({ namespace, patch });
        return Promise.resolve();
      },
    };
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      requests.push({ url, init });
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    mountProbe(server);
    apply(makeCtx(server, settings), cfg());
    // 启动应用本身不是"在用"：没有请求被放行就一个报文都不发。
    expect(fetchMock).not.toHaveBeenCalled();
    const guarded = probeHandler(server);
    expect(isGuarded(guarded)).toBe(true);

    await guarded(makeReq(), makeRes());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(bodyOf(requests[0]?.init)) as {
      metrics: { mode: string; totp: string; users: string };
    };
    expect(payload.metrics).toEqual({ mode: "token", totp: "off", users: "1" });
    // id 经宿主 settings 服务写回本插件的配置条目（命名空间 = 插件名）。
    expect(writes).toHaveLength(1);
    expect(writes[0]?.namespace).toBe("dsh-auth-gate");
    expect(typeof (writes[0]?.patch as { installId?: unknown }).installId).toBe("string");

    await guarded(makeReq(), makeRes());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the telemetry option is off", async () => {
    const server = makeFakeServer();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    mountProbe(server);
    apply(makeCtx(server, undefined), cfg({ telemetry: false }));

    await probeHandler(server)(makeReq(), makeRes());
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
