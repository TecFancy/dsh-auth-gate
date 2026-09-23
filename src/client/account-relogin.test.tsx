// @vitest-environment jsdom
/**
 * 改密成功后的离开动作（D24.1）在**组件层**的接线。
 *
 * 时间语义（成功那一刻就跳、只跳一次、URL 常量、replace）由 `account-redirect.test.ts` 用可注入的
 * nav 直接测模块；这里只钉组件的行为：成功就请求跳转一次、成功态面板与「重新登录」按钮留在场上
 * 当兜底（导航被环境拒绝时它还在这儿）、焦点先落到那个按钮、按钮永远可点、失败路径绝不把人送走。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const redirectApi = vi.hoisted(() => ({
  redirectToLogin: vi.fn(),
}));
vi.mock("./account-redirect.ts", () => ({
  LOGIN_REDIRECT_URL: "/auth/login?next=%2F&notice=password-changed",
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

/** 渲染面板并等 /auth/status 探针结算（此时表单在场）。 */
async function renderPanel(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsAccountSection, { t: zh }));
    await flushMicrotasks();
  });
  return { root, container };
}

/** 渲染到"改密成功"这一刻（服务端 200）。 */
async function renderSuccess(): Promise<{ root: Root; container: HTMLDivElement }> {
  fetchMock.mockImplementation((input: unknown) =>
    Promise.resolve(
      String(input) === "/auth/status"
        ? { ok: true, status: 200, json: () => Promise.resolve({ authenticated: true }) }
        : { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) },
    ),
  );
  const { root, container } = await renderPanel();
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
  it("requests the login redirect on success and keeps the fallback way out", async () => {
    const { root, container } = await renderSuccess();
    expect(redirectApi.redirectToLogin).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("密码已改");
    const relogin = container.querySelector("button");
    expect(relogin?.textContent).toBe("重新登录");
    // a11y（WCAG 2.2.1）：跳转被环境拒绝时这个按钮是唯一出路，焦点先落上去且永不 disable
    expect(document.activeElement).toBe(relogin);
    expect(relogin?.disabled).toBe(false);

    act(() => {
      relogin?.click();
    });
    expect(redirectApi.redirectToLogin).toHaveBeenCalledTimes(2); // 连点幂等：同 URL 的又一次 replace
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("stays on the success state when navigation itself is refused", async () => {
    // 环境拒绝导航（沙箱 / 异常宿主）：密码已经改完，绝不能显示"修改失败"。
    redirectApi.redirectToLogin.mockImplementationOnce(() => {
      throw new Error("navigation blocked");
    });
    const { root, container } = await renderSuccess();
    expect(container.textContent).toContain("密码已改");
    expect(container.textContent).toContain("重新登录");
    expect(container.querySelector("form")).toBeNull();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("never sends the user away when the form did not pass validation", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ authenticated: true }),
      }),
    );
    const { root, container } = await renderPanel();
    setValue(container, "current", "old pass");
    // 只填当前口令：本地校验先挡下，不该发请求，更不该跳转
    act(() => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(redirectApi.redirectToLogin).not.toHaveBeenCalled();
    expect(container.querySelector("form")).not.toBeNull();
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
