import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAccountStatus, requestAccountStatus } from "./account-status.ts";

/**
 * 解析器直测：`/auth/status` 的线上形状 → 视图对象。
 *
 * `passkeyEnabled` 线上恒在（新服务端），但旧服务端没有该键：守卫必须把「缺键」与「非法值」
 * 都留成 `undefined`（不知道），只有真正的布尔才进视图。
 */
describe("parseAccountStatus: passkeyEnabled", () => {
  it("keeps true and false as sent by a new server", () => {
    expect(parseAccountStatus({ authenticated: true, passkeyEnabled: true }).passkeyEnabled).toBe(
      true,
    );
    expect(parseAccountStatus({ authenticated: true, passkeyEnabled: false }).passkeyEnabled).toBe(
      false,
    );
  });

  it("leaves it undefined for an old server that omits the key", () => {
    expect(parseAccountStatus({ authenticated: true }).passkeyEnabled).toBeUndefined();
  });

  it("leaves it undefined for a non-boolean value", () => {
    for (const value of ["true", 1, null, {}]) {
      expect(
        parseAccountStatus({ authenticated: true, passkeyEnabled: value }).passkeyEnabled,
      ).toBeUndefined();
    }
  });
});

/**
 * `passwordLoginDisabled`（`passkey: "required"`，issue #133）：与 `passkeyEnabled` 同一套
 * 加法兼容规则 - 缺键或非布尔一律 `undefined`，调用方不得据此推断「口令可用」。
 */
describe("parseAccountStatus: passwordLoginDisabled", () => {
  it("keeps true and false as sent by a new server", () => {
    expect(
      parseAccountStatus({ authenticated: true, passwordLoginDisabled: true })
        .passwordLoginDisabled,
    ).toBe(true);
    expect(
      parseAccountStatus({ authenticated: true, passwordLoginDisabled: false })
        .passwordLoginDisabled,
    ).toBe(false);
  });

  it("leaves it undefined for an old server that omits the key", () => {
    expect(parseAccountStatus({ authenticated: true }).passwordLoginDisabled).toBeUndefined();
  });

  it("leaves it undefined for a non-boolean value", () => {
    for (const value of ["true", 1, null, {}]) {
      expect(
        parseAccountStatus({ authenticated: true, passwordLoginDisabled: value })
          .passwordLoginDisabled,
      ).toBeUndefined();
    }
  });
});

/**
 * `mode` / `version`（2026-11-23）：设置页页脚的两个实例事实。同一套加法兼容规则 -
 * 缺键、类型不符、取值不在白名单一律 `undefined`（"不知道"），页脚据此少渲染一行，
 * 绝不反推实例模式、也绝不显示空版本号。
 */
describe("parseAccountStatus: mode and version", () => {
  it("keeps the two known modes", () => {
    expect(parseAccountStatus({ authenticated: true, mode: "token" }).mode).toBe("token");
    expect(parseAccountStatus({ authenticated: true, mode: "password" }).mode).toBe("password");
  });

  it("leaves an unknown or missing mode undefined", () => {
    for (const value of [undefined, "Token", "", "basic", 1, null]) {
      expect(parseAccountStatus({ authenticated: true, mode: value }).mode).toBeUndefined();
    }
  });

  it("keeps a non-empty version string verbatim", () => {
    expect(parseAccountStatus({ authenticated: true, version: "0.24.0-rc.1" }).version).toBe(
      "0.24.0-rc.1",
    );
  });

  it("treats an empty or non-string version as unknown", () => {
    // 空串 = host 读不到 package.json：显示成 `v` 比不显示更糟，这里统一归一成 undefined。
    for (const value of [undefined, "", 24, null, {}]) {
      expect(parseAccountStatus({ authenticated: true, version: value }).version).toBeUndefined();
    }
  });
});

/**
 * `logoutOrder` 也是白名单解析：只有整数才进视图，client 入口据此决定是否按 host 配置重注册；
 * 非整数/字符串/缺失一律 `undefined`（入口保留默认 order）。
 */
describe("parseAccountStatus: logoutOrder", () => {
  it("keeps an integer", () => {
    expect(parseAccountStatus({ authenticated: false, logoutOrder: 5000 }).logoutOrder).toBe(5000);
  });

  it("leaves non-integers and missing values undefined", () => {
    for (const value of [undefined, 1000.5, "1000", null, true]) {
      expect(
        parseAccountStatus({ authenticated: false, logoutOrder: value }).logoutOrder,
      ).toBeUndefined();
    }
  });
});

function statusResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

/** 挂起中的响应：由测试决定何时放行。 */
function deferredResponse(): { promise: Promise<Response>; resolve: (response: Response) => void } {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = (response) => done(response);
  });
  return { promise, resolve };
}

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/**
 * 共享探针（C9）：一次页面加载里入口探针、账户区 hook 与登出按钮只发一个 `/auth/status`；
 * 每个消费方用自己的 signal 退订，最后一个退订才 abort 底层请求。
 */
describe("requestAccountStatus (shared probe)", () => {
  it("coalesces concurrent consumers into one request", async () => {
    const fetch = vi.fn().mockResolvedValue(statusResponse({ authenticated: true }));
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([requestAccountStatus(), requestAccountStatus()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
  });

  it("maps a non-ok response to a probe failure, not to an unauthenticated view", async () => {
    // C9：5xx 是「暂时不可用」，不能让账户区塌缩成「请先登录」。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("html")),
      }),
    );
    await expect(requestAccountStatus()).resolves.toEqual({ kind: "failure" });
  });

  it("maps a malformed 200 body to a probe failure, not to an unauthenticated view", async () => {
    for (const body of [{}, { authenticated: "yes" }, null]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) }),
      );
      await expect(requestAccountStatus()).resolves.toEqual({ kind: "failure" });
    }
  });

  it("maps an unparseable 200 body to a probe failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("not json")),
      }),
    );
    await expect(requestAccountStatus()).resolves.toEqual({ kind: "failure" });
  });

  it("maps 401 to an ok, unauthenticated view (session gone, not a probe failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );
    const result = await requestAccountStatus();
    expect(result).toEqual({ kind: "ok", status: { authenticated: false } });
  });

  it("keeps the request alive until the last subscriber aborts", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const leftover = new AbortController();
    const leaving = new AbortController();
    const waiting = requestAccountStatus(leftover.signal);
    const leavingResult = requestAccountStatus(leaving.signal);
    const signal = (fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)?.signal;

    leaving.abort();
    await expect(leavingResult).resolves.toEqual({ kind: "aborted" });
    expect(signal?.aborted).toBe(false); // 还有消费方在等：不能 abort

    leftover.abort();
    await expect(waiting).resolves.toEqual({ kind: "aborted" });
    expect(signal?.aborted).toBe(true); // 最后一个退订者负责 abort
    pending.resolve(statusResponse({ authenticated: true }));
  });
});
