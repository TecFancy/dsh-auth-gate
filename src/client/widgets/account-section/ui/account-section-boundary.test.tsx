// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "../../../shared/i18n/index.ts";
import { SettingsAccountSection } from "./account-section.tsx";

/**
 * 错误边界（C7）：账户区内部渲染抛错时只炸这一块，并留一条可读的兜底文案，
 * 不能让异常冒到宿主设置页把整个面板白屏。
 *
 * 用 mock 让状态 hook 在渲染期直接抛：真实的渲染期异常源（如日期格式化）已经各自加了守卫，
 * 这里测的是**最后一道网**。
 */
vi.mock("../../../entities/account/index.ts", () => ({
  useAccountStatus: (): never => {
    throw new Error("render boom");
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const zh = (key: string, params?: Record<string, unknown>): string =>
  formatCopy(ACCOUNT_DICT_ZH[key] ?? key, params);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SettingsAccountSection error boundary", () => {
  it("renders the fallback notice instead of escaping the render error", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(SettingsAccountSection, { t: zh }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain(zh("account.loadFailed"));
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
