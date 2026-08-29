// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./context.ts";
import { apply } from "./index.tsx";
import { SettingsLogoutAction } from "./logout-action.tsx";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 让 fetch mock 的整条微任务链（json → setAuthenticated）在 act 内跑完。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** 渲染组件到独立容器（jsdom），返回 root 供卸载。 */
async function renderElement(
  element: ReturnType<typeof createElement>,
): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
    await flushMicrotasks();
  });
  return { root, container };
}

/** 构造带 mock 的 AuthContext（slots + locale + effect）。 */
function makeApplyHarness() {
  const localeRegisters: [string, string, Record<string, string>][] = [];
  const locale = {
    register: vi.fn((ns: string, loc: string, dict: Record<string, string>): (() => void) => {
      localeRegisters.push([ns, loc, dict]);
      return () => undefined;
    }),
    bind: vi.fn(() => (key: string) => (key === "logout" ? "Sign out" : key)),
  };
  const injectCalls: [string, () => () => void][] = [];
  const slots = {
    inject: vi.fn((key: string, callback: () => () => void) => {
      injectCalls.push([key, callback]);
      return () => undefined;
    }),
    register: vi.fn(() => () => undefined),
  };
  const effect = vi.fn((setup: () => () => void | Iterable<() => void>): void => {
    setup();
  });
  const ctx = { slots, locale, effect } as unknown as AuthContext;
  return { ctx, localeRegisters, slots, injectCalls };
}

describe("apply", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  /** 通用 status 探针响应：默认 logoutOrder 1000（与 host Config 一致，不触发重注册）。 */
  function defaultStatus(): unknown {
    return { json: () => Promise.resolve({ authenticated: false, logoutOrder: 1000 }) };
  }

  it("registers zh/en logout dicts and adds the CTA to the settings General item slot", async () => {
    fetchMock.mockResolvedValue(defaultStatus());
    const h = makeApplyHarness();
    apply(h.ctx);
    for (const [, callback] of h.injectCalls) callback();
    await flushMicrotasks();
    expect(h.localeRegisters).toEqual([
      ["auth", "zh", { logout: "退出登录" }],
      ["auth", "en", { logout: "Sign out" }],
    ]);
    expect(h.injectCalls.map(([key]) => key).sort((a, b) => a.localeCompare(b))).toEqual([
      "settings.general.item",
    ]);
    const register = h.slots.register as ReturnType<typeof vi.fn>;
    expect(register).toHaveBeenCalledTimes(1);
    const call = register.mock.calls[0] as unknown as [
      { name: string; id: string; locale: string; order: number; label: unknown },
      unknown,
    ];
    const [opts, component] = call;
    expect(opts.name).toBe("settings.general.item");
    expect(opts.id).toBe("dsh-auth-gate-logout");
    expect(opts.locale).toBe("auth");
    expect(opts.order).toBe(1000);
    expect(typeof opts.label).toBe("function");
    expect((opts.label as () => string)()).toBe("Sign out");
    expect(component).toBe(SettingsLogoutAction);
  });

  it("re-registers the CTA with the host-configured logoutOrder when it differs from the default", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ authenticated: true, logoutOrder: 5000 }),
    });
    const h = makeApplyHarness();
    apply(h.ctx);
    for (const [, callback] of h.injectCalls) callback();
    const register = h.slots.register as ReturnType<typeof vi.fn>;
    await flushMicrotasks();
    expect(register).toHaveBeenCalledTimes(2);
    const first = register.mock.calls[0]![0] as { order: number };
    const second = register.mock.calls[1]![0] as { order: number };
    expect(first.order).toBe(1000);
    expect(second.order).toBe(5000);
  });

  it("keeps a single default-order registration when the status probe fails", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const h = makeApplyHarness();
    apply(h.ctx);
    for (const [, callback] of h.injectCalls) callback();
    const register = h.slots.register as ReturnType<typeof vi.fn>;
    await flushMicrotasks();
    expect(register).toHaveBeenCalledTimes(1);
    expect((register.mock.calls[0]![0] as { order: number }).order).toBe(1000);
  });

  it("keeps a single default-order registration when the probe returns a non-numeric order", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ authenticated: true, logoutOrder: "late" }),
    });
    const h = makeApplyHarness();
    apply(h.ctx);
    for (const [, callback] of h.injectCalls) callback();
    const register = h.slots.register as ReturnType<typeof vi.fn>;
    await flushMicrotasks();
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsLogoutAction (settings General CTA)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  /** /auth/status 返回给定 authenticated 值。 */
  function statusResponse(authenticated: boolean): unknown {
    return { json: () => Promise.resolve({ authenticated }) };
  }

  function enT(): () => string {
    return () => "Sign out";
  }

  it("renders a prominent logout CTA (post form + 16px icon + en text) when authenticated", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderElement(
      createElement(SettingsLogoutAction, { t: enT() }),
    );
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("action")).toBe("/auth/logout?next=/");
    expect(form?.getAttribute("method")).toBe("post");
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Sign out");
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(button?.textContent).toContain("Sign out");
    root.unmount();
    container.remove();
  });

  it("shows the zh label when the injected t translates logout to 退出登录", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const zh = () => "退出登录";
    const { root, container } = await renderElement(createElement(SettingsLogoutAction, { t: zh }));
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("退出登录");
    expect(button?.textContent).toContain("退出登录");
    root.unmount();
    container.remove();
  });

  it("renders nothing when unauthenticated", async () => {
    fetchMock.mockResolvedValue(statusResponse(false));
    const { root, container } = await renderElement(
      createElement(SettingsLogoutAction, { t: enT() }),
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toBe("");
    root.unmount();
    container.remove();
  });

  it("renders nothing when the status fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const { root, container } = await renderElement(
      createElement(SettingsLogoutAction, { t: enT() }),
    );
    expect(container.querySelector("form")).toBeNull();
    root.unmount();
    container.remove();
  });

  it("brightens the CTA on hover and clears the filter on leave", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderElement(
      createElement(SettingsLogoutAction, { t: enT() }),
    );
    const button = container.querySelector("button")!;
    expect(button.style.filter).toBe("");
    act(() => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(button.style.filter).toBe("brightness(1.08)");
    act(() => {
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(button.style.filter).toBe("");
    root.unmount();
    container.remove();
  });
});
