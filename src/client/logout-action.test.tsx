// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./context.ts";
import { apply } from "./index.tsx";
import { LogoutAction } from "./logout-action.tsx";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 让 fetch mock 的整条微任务链（json → setAuthenticated）在 act 内跑完。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** 渲染 LogoutAction 到独立容器（jsdom），返回 root 供卸载。 */
async function renderAction(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(LogoutAction));
    await flushMicrotasks();
  });
  return { root, container };
}

describe("apply", () => {
  it("registers the sign-out entry in conversation.session.header.utilities", () => {
    let captured: (() => () => void) | undefined;
    const inject = vi.fn((_key: string, callback: () => () => void) => {
      captured = callback;
      return undefined;
    });
    const register = vi.fn(() => undefined);
    const ctx = { slots: { inject, register } } as unknown as AuthContext;
    apply(ctx);
    expect(inject).toHaveBeenCalledWith(
      "conversation.session.header.utilities",
      expect.any(Function),
    );
    captured?.();
    expect(register).toHaveBeenCalledWith(
      {
        name: "conversation.session.header.utilities",
        id: "dsh-auth-gate-logout",
        order: 10,
        label: "Sign out",
      },
      LogoutAction,
    );
  });
});

describe("LogoutAction", () => {
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

  it("renders an icon-only logout form when /auth/status says authenticated", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderAction();
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("action")).toBe("/auth/logout?next=/");
    expect(form?.getAttribute("method")).toBe("post");
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Sign out");
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(button?.textContent).toBe("");
    root.unmount();
    container.remove();
  });

  it("renders nothing when unauthenticated", async () => {
    fetchMock.mockResolvedValue(statusResponse(false));
    const { root, container } = await renderAction();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toBe("");
    root.unmount();
    container.remove();
  });

  it("renders nothing when the status fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const { root, container } = await renderAction();
    expect(container.querySelector("form")).toBeNull();
    root.unmount();
    container.remove();
  });

  it("shows the theme token hover background and clears it on leave", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderAction();
    const button = container.querySelector("button")!;
    expect(button.style.background).toBe("transparent");
    act(() => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(button.style.background).toBe("var(--dsw-alias-interactive-bg-hover)");
    act(() => {
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(button.style.background).toBe("transparent");
    root.unmount();
    container.remove();
  });
});
