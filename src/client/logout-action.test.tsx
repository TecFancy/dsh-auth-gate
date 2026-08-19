// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./context.ts";
import { apply } from "./index.tsx";
import { HeroLogoutAction, LogoutAction } from "./logout-action.tsx";

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

describe("apply", () => {
  it("registers the sign-out entry in the session header and the hero overlay", () => {
    const injectCalls: [string, () => () => void][] = [];
    const inject = vi.fn((key: string, callback: () => () => void) => {
      injectCalls.push([key, callback]);
      return () => undefined;
    });
    const register = vi.fn(() => undefined);
    const ctx = { slots: { inject, register } } as unknown as AuthContext;
    apply(ctx);
    expect(injectCalls.map(([key]) => key).sort((a, b) => a.localeCompare(b))).toEqual(
      ["conversation.session.header.utilities", "shell.overlay"].sort((a, b) => a.localeCompare(b)),
    );
    for (const [, callback] of injectCalls) callback();
    expect(register).toHaveBeenCalledWith(
      {
        name: "conversation.session.header.utilities",
        id: "dsh-auth-gate-logout",
        order: 10,
        label: "Sign out",
      },
      LogoutAction,
    );
    expect(register).toHaveBeenCalledWith(
      {
        name: "shell.overlay",
        id: "dsh-auth-gate-logout-hero",
        order: 10,
        label: "Sign out (hero)",
      },
      HeroLogoutAction,
    );
  });
});

describe("LogoutAction (session header)", () => {
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
    const { root, container } = await renderElement(createElement(LogoutAction));
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
    const { root, container } = await renderElement(createElement(LogoutAction));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toBe("");
    root.unmount();
    container.remove();
  });

  it("renders nothing when the status fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const { root, container } = await renderElement(createElement(LogoutAction));
    expect(container.querySelector("form")).toBeNull();
    root.unmount();
    container.remove();
  });

  it("shows the theme token hover background and clears it on leave", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderElement(createElement(LogoutAction));
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

describe("HeroLogoutAction (root overlay, new-session page)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function statusResponse(authenticated: boolean): unknown {
    return { json: () => Promise.resolve({ authenticated }) };
  }

  function sessionsHook(current: string | undefined) {
    return (selector: (state: { current?: string }) => string | undefined) =>
      selector(typeof current === "undefined" ? {} : { current });
  }

  it("renders the floating logout when authenticated and no session is current", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderElement(
      createElement(HeroLogoutAction, { useSessions: sessionsHook(undefined) }),
    );
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("action")).toBe("/auth/logout?next=/");
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Sign out");
    root.unmount();
    container.remove();
  });

  it("renders nothing when a session is current", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderElement(
      createElement(HeroLogoutAction, { useSessions: sessionsHook("session-1") }),
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toBe("");
    root.unmount();
    container.remove();
  });

  it("renders nothing when unauthenticated even without a current session", async () => {
    fetchMock.mockResolvedValue(statusResponse(false));
    const { root, container } = await renderElement(
      createElement(HeroLogoutAction, { useSessions: sessionsHook(undefined) }),
    );
    expect(container.querySelector("form")).toBeNull();
    root.unmount();
    container.remove();
  });

  it("renders when useSessions is absent (treated as no current session)", async () => {
    fetchMock.mockResolvedValue(statusResponse(true));
    const { root, container } = await renderElement(createElement(HeroLogoutAction, {}));
    expect(container.querySelector("form")).not.toBeNull();
    root.unmount();
    container.remove();
  });
});
