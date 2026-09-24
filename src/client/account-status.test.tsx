// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";
import { useAccountStatus } from "./account-status.ts";

// 管理块只做「渲染门」标记（契约 §5-3）：真组件的列表/表单/请求语义由 client-view 的
// 测试与 lead 的集成测试覆盖，这里只证明门条件（admin + 正式会话 + 字符串 name）。
vi.mock("./admin-block.tsx", async () => {
  const { createElement: h } = await import("react");
  return {
    AdminUsersBlock: (props: { actorName: string; actorTotpEnabled: boolean }): ReactElement =>
      h("div", {
        "data-testid": "admin-block",
        "data-actor": props.actorName,
        "data-totp": String(props.actorTotpEnabled),
      }),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
/** 记录每次请求的 url/init（不读 mock.calls 的 any 值，保持类型安全）。 */
const requests: [string, RequestInit | undefined][] = [];

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function render(element: ReactElement): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
    await flushMicrotasks();
  });
  return { root, container };
}

function cleanup(root: Root, container: HTMLElement): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

/** 探针组件：把 status 原样序列化出来，便于断言守卫后的字段集合。 */
function StatusProbe(): ReactElement {
  const status = useAccountStatus();
  return createElement("pre", { "data-testid": "status" }, JSON.stringify(status));
}

function probeOf(container: HTMLElement): unknown {
  return JSON.parse(container.querySelector('[data-testid="status"]')?.textContent ?? "null");
}

function adminBlockOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="admin-block"]');
}

function requestedUrls(): string[] {
  return requests.map(([url]) => url);
}

function statusBody(body: unknown): unknown {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function routeFetch(handler: (url: string, init: RequestInit) => unknown): void {
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    requests.push([String(input), init]);
    return Promise.resolve(handler(String(input), init ?? {}));
  });
}

/** 挂起中的响应：由测试决定何时放行。 */
function deferred(): { promise: Promise<unknown>; release: (value: unknown) => void } {
  let release: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((resolve) => {
    release = (value) => resolve(value);
  });
  return { promise, release };
}

/** 与 host locale 同形的 translate（支持 {seconds} 插值）。 */
const zh = (key: string, params?: Record<string, unknown>): string =>
  formatCopy(ACCOUNT_DICT_ZH[key] ?? key, params);

/** 完整身份投影（新服务端，含 disabled/mustChangePassword 等未被本层消费的字段）。 */
function fullStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authenticated: true,
    logoutOrder: 1000,
    name: "bob",
    role: "user",
    disabled: false,
    totpEnabled: false,
    mustChangePassword: false,
    sessionKind: "full",
    ...overrides,
  };
}

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("useAccountStatus", () => {
  it("requests /auth/status with same-origin credentials and an abort signal", async () => {
    routeFetch(() => statusBody({ authenticated: false, logoutOrder: 1000 }));
    const { root, container } = await render(createElement(StatusProbe));
    expect(requestedUrls()).toEqual(["/auth/status"]);
    const init = requests[0]![1]!;
    expect(init.credentials).toBe("same-origin");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(probeOf(container)).toEqual({ authenticated: false });
    cleanup(root, container);
  });

  it("parses the additive identity projection", async () => {
    routeFetch(() =>
      statusBody(
        fullStatus({ name: "alice", role: "admin", totpEnabled: true, sessionKind: "full" }),
      ),
    );
    const { root, container } = await render(createElement(StatusProbe));
    expect(probeOf(container)).toEqual({
      authenticated: true,
      name: "alice",
      role: "admin",
      disabled: false,
      totpEnabled: true,
      sessionKind: "full",
    });
    cleanup(root, container);
  });

  it("keeps additive fields undefined for an old server and for illegal values", async () => {
    routeFetch(() => statusBody({ authenticated: true, logoutOrder: 1000 }));
    const old = await render(createElement(StatusProbe));
    expect(probeOf(old.container)).toEqual({ authenticated: true });
    cleanup(old.root, old.container);

    routeFetch(() =>
      statusBody({
        authenticated: true,
        name: 42,
        role: "superuser",
        disabled: "no",
        totpEnabled: "yes",
        sessionKind: "partial",
      }),
    );
    const illegal = await render(createElement(StatusProbe));
    expect(probeOf(illegal.container)).toEqual({ authenticated: true });
    cleanup(illegal.root, illegal.container);
  });

  it("treats a failed or malformed probe as unauthenticated", async () => {
    routeFetch(() => Promise.reject(new Error("network")));
    const failed = await render(createElement(StatusProbe));
    expect(probeOf(failed.container)).toEqual({ authenticated: false });
    cleanup(failed.root, failed.container);

    routeFetch(() => ({ ok: false, status: 503, json: () => Promise.reject(new Error("html")) }));
    const malformed = await render(createElement(StatusProbe));
    expect(probeOf(malformed.container)).toEqual({ authenticated: false });
    cleanup(malformed.root, malformed.container);
  });

  it("aborts on unmount and ignores the late response", async () => {
    const pending = deferred();
    routeFetch(() => pending.promise);
    const { root, container } = await render(createElement(StatusProbe));
    const signal = requests[0]![1]!.signal;
    expect(signal?.aborted).toBe(false);
    act(() => {
      root.unmount();
    });
    expect(signal?.aborted).toBe(true);
    pending.release(statusBody(fullStatus({ name: "alice", role: "admin" })));
    await flushMicrotasks();
    expect(container.innerHTML).toBe("");
    container.remove();
  });
});

describe("SettingsAccountSection 身份渲染门（契约 §9-A1/§5-3）", () => {
  it("non-admin: only the change form, and fetch touches nothing but /auth/status", async () => {
    routeFetch(() => statusBody(fullStatus()));
    const { root, container } = await render(createElement(SettingsAccountSection, { t: zh }));
    expect(container.querySelector("form")).not.toBeNull();
    expect(adminBlockOf(container)).toBeNull();
    // A11：用 pathname 集合断言（React StrictMode 可能双调用，禁止断次数）。
    expect(new Set(requestedUrls())).toEqual(new Set(["/auth/status"]));
    cleanup(root, container);
  });

  it("admin with a full session renders the block with actor name and totp flag", async () => {
    routeFetch(() => statusBody(fullStatus({ name: "alice", role: "admin", totpEnabled: true })));
    const { root, container } = await render(createElement(SettingsAccountSection, { t: zh }));
    const block = adminBlockOf(container);
    expect(block).not.toBeNull();
    expect(block?.getAttribute("data-actor")).toBe("alice");
    expect(block?.getAttribute("data-totp")).toBe("true");
    cleanup(root, container);
  });

  it("admin in a restricted session gets no block (受限会话不进管理面)", async () => {
    routeFetch(() =>
      statusBody(fullStatus({ name: "alice", role: "admin", sessionKind: "password-change-only" })),
    );
    const { root, container } = await render(createElement(SettingsAccountSection, { t: zh }));
    expect(container.querySelector("form")).not.toBeNull();
    expect(adminBlockOf(container)).toBeNull();
    cleanup(root, container);
  });

  it("admin whose name is missing or not a string gets no block (加法兼容)", async () => {
    routeFetch(() => statusBody(fullStatus({ role: "admin", name: undefined })));
    const missing = await render(createElement(SettingsAccountSection, { t: zh }));
    expect(adminBlockOf(missing.container)).toBeNull();
    cleanup(missing.root, missing.container);

    routeFetch(() => statusBody(fullStatus({ role: "admin", name: 42 })));
    const illegal = await render(createElement(SettingsAccountSection, { t: zh }));
    expect(adminBlockOf(illegal.container)).toBeNull();
    cleanup(illegal.root, illegal.container);
  });

  it("partial additive fields never count as admin rights (A1：不渲染且零管理请求)", async () => {
    const partials: Record<string, unknown>[] = [
      // 有 role 无 sessionKind：不得再用 ?? "full" 兜底
      { name: "alice", role: "admin", disabled: false },
      // 禁用 admin 不挂块
      { name: "alice", role: "admin", disabled: true, sessionKind: "full" },
      // disabled 缺失（旧服务端字段不全）
      { name: "alice", role: "admin", sessionKind: "full" },
    ];
    for (const partial of partials) {
      requests.length = 0;
      routeFetch(() => statusBody({ authenticated: true, logoutOrder: 1000, ...partial }));
      const { root, container } = await render(createElement(SettingsAccountSection, { t: zh }));
      expect(adminBlockOf(container)).toBeNull();
      expect(new Set(requestedUrls())).toEqual(new Set(["/auth/status"]));
      cleanup(root, container);
    }
  });

  it("old server without identity fields: form only, no throw, no admin request", async () => {
    routeFetch(() => statusBody({ authenticated: true, logoutOrder: 1000 }));
    const { root, container } = await render(createElement(SettingsAccountSection, { t: zh }));
    expect(container.querySelector("form")).not.toBeNull();
    expect(adminBlockOf(container)).toBeNull();
    expect(new Set(requestedUrls())).toEqual(new Set(["/auth/status"]));
    cleanup(root, container);
  });

  it("before the first response: loading notice, no block, no admin request", async () => {
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      requests.push([String(input), init]);
      return new Promise(() => undefined);
    });
    const { root, container } = await render(createElement(SettingsAccountSection, { t: zh }));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("正在确认登录状态");
    expect(adminBlockOf(container)).toBeNull();
    expect(new Set(requestedUrls())).toEqual(new Set(["/auth/status"]));
    cleanup(root, container);
  });
});
