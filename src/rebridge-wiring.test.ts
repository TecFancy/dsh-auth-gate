/**
 * 重铸钩子的判定矩阵：只对「顶层文档导航到首页」生效，宿主不认才跳，跳一次就够。
 *
 * 这里用假 `connection` 与假 `ctx`，把钩子的每个分支单独钉住；真栈（真实 cordis + webserver +
 * storage）上的端到端行为在 `test/integration/integration.rebridge.test.ts`。
 */
import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import type { GuardKind, GuardRequest } from "./host/shared/guard/index.js";
import { makeRebridge, REBRIDGE_MARKER_COOKIE } from "./rebridge-wiring.js";

const log = { warn: () => undefined, info: () => undefined };

/** 假 ctx：`connection` 与 launch token 都可控。 */
function makeCtx(options: {
  rejection?: 401 | 403 | undefined;
  hasConnection?: boolean;
  hasSeam?: boolean;
  token?: string | undefined;
}): Context {
  const connection =
    options.hasConnection === false
      ? undefined
      : {
          ...(options.hasSeam === false
            ? {}
            : {
                requestRejection: () => options.rejection,
              }),
        };
  return {
    get: (name: string) => {
      if (name === "connection") return connection;
      return undefined;
    },
  } as unknown as Context;
}

/** 带 launch token 的 ctx：`authenticatedUrl` 是桥与重铸共用的唯一 token 来源。 */
function ctxWithToken(token: string | undefined, rejection: 401 | 403 | undefined): Context {
  const base = makeCtx({ rejection });
  return {
    get: (name: string) => {
      if (name === "connection") {
        return {
          requestRejection: () => rejection,
          ...(token === undefined
            ? {}
            : { authenticatedUrl: () => `http://127.0.0.1/?token=${token}` }),
        };
      }
      return (base as unknown as { get(name: string): unknown }).get(name);
    },
  } as unknown as Context;
}

function req(
  url = "/",
  headers: Record<string, string> = { "sec-fetch-dest": "document" },
  method = "GET",
): GuardRequest {
  return { url, method, headers };
}

const config = { cookieSecure: true };

describe("重铸钩子：触发条件", () => {
  it("宿主不认 + 顶层文档导航到首页 → 302 到相对 /?token=", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), config, log);
    const decision = hook(req(), "fallback", "/");
    expect(decision?.location).toBe("/?token=launchTok");
  });

  it("宿主认了 → 不重铸", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", undefined), config, log);
    expect(hook(req(), "fallback", "/")).toBeUndefined();
  });

  it("宿主回 403 不重铸（Host/Origin 围栏拒绝，换 token 走到同一个围栏还是 403）", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 403), config, log);
    expect(hook(req(), "fallback", "/")).toBeUndefined();
  });

  it("非首页、非 GET、非导航、upgrade 一律不重铸", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), config, log);
    expect(hook(req("/api/session/list"), "prefix", "/api/session/list")).toBeUndefined();
    expect(
      hook(req("/", { "sec-fetch-dest": "document" }, "POST"), "fallback", "/"),
    ).toBeUndefined();
    expect(hook(req("/", {}), "fallback", "/")).toBeUndefined();
    expect(hook(req("/", { "sec-fetch-dest": "document" }), "upgrade", "/")).toBeUndefined();
  });

  it("URL 已带宿主 token 时不重铸（那一跳正是宿主在签发 cookie，重铸会自指）", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), config, log);
    for (const url of ["/?token=launchTok", "/?token=stale", "/?a=1&token=x", "/?token="]) {
      expect(hook(req(url), "fallback", "/"), url).toBeUndefined();
    }
  });

  it("Sec-Fetch-Mode: navigate 单独也够（部分客户端不发 Dest）", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), config, log);
    expect(hook(req("/", { "sec-fetch-mode": "navigate" }), "fallback", "/")?.location).toBe(
      "/?token=launchTok",
    );
  });
});

describe("重铸钩子：防循环与降级", () => {
  it("标记还在时不再重铸（第二次仍被拒就交给宿主回 401）", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), config, log);
    const marked = req("/", {
      "sec-fetch-dest": "document",
      cookie: `${REBRIDGE_MARKER_COOKIE}=1`,
    });
    expect(hook(marked, "fallback", "/")).toBeUndefined();
  });

  it("重铸时随 302 下发标记 cookie，属性与会话 cookie 同源", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), config, log);
    const decision = hook(req(), "fallback", "/");
    expect(decision?.setCookie).toBe(
      `${REBRIDGE_MARKER_COOKIE}=1; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("cookieSecure=false 时标记不带 Secure（纯 http 测试环境）", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), { cookieSecure: false }, log);
    expect(hook(req(), "fallback", "/")?.setCookie).toBe(
      `${REBRIDGE_MARKER_COOKIE}=1; Max-Age=60; Path=/; HttpOnly; SameSite=Lax`,
    );
  });

  it("取不到 launch token 时不重铸（没有 token 的 /?token= 只会再被拒一次）", () => {
    const hook = makeRebridge(ctxWithToken(undefined, 401), config, log);
    expect(hook(req(), "fallback", "/")).toBeUndefined();
  });

  it("connection 缺失或没有 requestRejection 时停用，只告警一次", () => {
    for (const options of [{ hasConnection: false }, { hasSeam: false }]) {
      const warnings: unknown[] = [];
      const hook = makeRebridge(makeCtx(options), config, {
        warn: (message) => warnings.push(message),
        info: () => undefined,
      });
      expect(hook(req(), "fallback", "/")).toBeUndefined();
      expect(hook(req(), "fallback", "/")).toBeUndefined();
      expect(warnings).toHaveLength(1);
    }
  });

  it("宿主 requestRejection 抛错时按 401 处理并重铸，钩子自己不抛", () => {
    const ctx = {
      get: () => ({
        requestRejection: () => {
          throw new Error("boom");
        },
        authenticatedUrl: () => "http://127.0.0.1/?token=launchTok",
      }),
    } as unknown as Context;
    const hook = makeRebridge(ctx, config, log);
    expect(hook(req(), "fallback", "/")?.location).toBe("/?token=launchTok");
  });
});

describe("重铸钩子：Location 消毒", () => {
  it("token 里的特殊字符被编码，Location 仍是站内相对路径", () => {
    const hook = makeRebridge(ctxWithToken("a b/c=d", 401), config, log);
    const location = hook(req(), "fallback", "/")?.location;
    expect(location).toBe("/?token=a%20b%2Fc%3Dd");
    expect(location?.startsWith("/")).toBe(true);
    expect(location?.startsWith("//")).toBe(false);
  });
});

describe("重铸钩子：kind 透传", () => {
  it("exact 与 fallback 两种入口都生效", () => {
    const hook = makeRebridge(ctxWithToken("launchTok", 401), config, log);
    for (const kind of ["exact", "fallback"] as GuardKind[]) {
      expect(hook(req(), kind, "/")?.location).toBe("/?token=launchTok");
    }
  });
});
