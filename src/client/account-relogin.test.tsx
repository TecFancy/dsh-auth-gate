// @vitest-environment jsdom
/**
 * 改密成功后的离开动作（P1.1 / D24）在**组件层**的接线。
 *
 * 时间语义（2.5s、重排去重、点击取消待跳、URL 常量）由 `account-redirect.test.ts` 用可注入的
 * nav 直接测模块；这里只钉组件的行为：成功后请求排程一次、点按钮立刻跳一次、**卸载不取消待跳**
 * （取消等于把人留在死会话壳里，复审否掉过）、按钮永远可点。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const redirectApi = vi.hoisted(() => ({
  scheduleRedirectToLogin: vi.fn(),
  redirectToLoginNow: vi.fn(),
  cancelScheduledRedirect: vi.fn(),
}));
vi.mock("./account-redirect.ts", () => ({
  LOGIN_REDIRECT_URL: "/auth/login?next=%2F&notice=password-changed",
  LOGIN_REDIRECT_DELAY_MS: 2500,
  ...redirectApi,
}));

/** 让 fetch mock 的整条微任务链在 act 内跑完。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const zh = (key: string, params?: Record<string, unknown>): string =>
  formatCopy(ACCOUNT_DICT_ZH[key] ?? key, params);

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  for (const fn of Object.values(redirectApi)) fn.mockReset();
});

/** React 受控输入的写值方式：走原型 setter 再派发 input 事件。 */
function setValue(container: HTMLElement, name: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`missing input[name=${name}]`);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") as
    { set: (this: HTMLInputElement, value: string) => void } | undefined;
  if (descriptor === undefined) throw new Error("HTMLInputElement value setter missing");
  act(() => {
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 渲染到"已提交成功"这一刻（表单已消失，成功文案 + 重新登录按钮在场）。 */
async function renderSuccess(): Promise<{ root: Root; container: HTMLDivElement }> {
  fetchMock.mockImplementation((input: unknown) =>
    Promise.resolve(
      String(input) === "/auth/status"
        ? { ok: true, status: 200, json: () => Promise.resolve({ authenticated: true }) }
        : { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) },
    ),
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsAccountSection, { t: zh }));
    await flushMicrotasks();
  });
  setValue(container, "current", "old pass");
  setValue(container, "password", "NewPassw0rd");
  setValue(container, "confirm", "NewPassw0rd");
  act(() => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await flushMicrotasks();
  });
  return { root, container };
}

describe("SettingsAccountSection post-success wiring", () => {
  it("schedules the login redirect once and offers an immediate way out", async () => {
    const { root, container } = await renderSuccess();
    expect(container.textContent).toContain("密码已改");
    const relogin = container.querySelector("button");
    expect(relogin?.textContent).toBe("重新登录");
    // a11y（WCAG 2.2.1）：焦点先落到唯一出路，键盘用户不必等自动跳
    expect(document.activeElement).toBe(relogin);
    expect(relogin?.disabled).toBe(false); // 自动跳失败时按钮是唯一出路，永不 disable
    expect(redirectApi.scheduleRedirectToLogin).toHaveBeenCalledTimes(1);
    expect(redirectApi.redirectToLoginNow).not.toHaveBeenCalled();

    act(() => {
      relogin?.click();
    });
    expect(redirectApi.redirectToLoginNow).toHaveBeenCalledTimes(1);
    act(() => {
      relogin?.click();
    });
    expect(redirectApi.redirectToLoginNow).toHaveBeenCalledTimes(2); // 连点幂等，由模块内清定时器保证
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("never cancels the pending redirect when the host tears the panel down", async () => {
    const { root, container } = await renderSuccess();
    act(() => {
      root.unmount();
    });
    container.remove();
    expect(redirectApi.scheduleRedirectToLogin).toHaveBeenCalledTimes(1);
    expect(redirectApi.cancelScheduledRedirect).not.toHaveBeenCalled();
  });
});
