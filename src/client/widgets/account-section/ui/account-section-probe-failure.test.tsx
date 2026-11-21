// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "../../../shared/i18n/index.ts";
import { SettingsAccountSection } from "./account-section.tsx";

/**
 * C9：`/auth/status` 探针失败（网络/5xx）是「暂时不可用」，不是「未登录」。
 * 账户区必须给独立提示 + 可用的重试，不能把用户钉在「请先登录」上。
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  document.body.innerHTML = "";
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function cleanup(root: Root, container: HTMLElement): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

const zh = (key: string, params?: Record<string, unknown>): string =>
  formatCopy(ACCOUNT_DICT_ZH[key] ?? key, params);

function statusBody(body: unknown): unknown {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** 完整身份投影：重试成功后渲染门应放行管理块/表单。 */
function fullStatus(): Record<string, unknown> {
  return {
    authenticated: true,
    logoutOrder: 1000,
    name: "bob",
    role: "user",
    disabled: false,
    totpEnabled: false,
    mustChangePassword: false,
    sessionKind: "full",
  };
}

function routeFetch(handler: () => unknown): void {
  fetchMock.mockImplementation(() => Promise.resolve(handler()));
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

describe("SettingsAccountSection 探针失败态（C9）", () => {
  it("renders an unavailable state with a working retry instead of 'sign in first'", async () => {
    let attempts = 0;
    routeFetch(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("network"));
      return statusBody(fullStatus());
    });
    const { root, container } = await render(createElement(SettingsAccountSection, { t: zh }));
    expect(container.textContent).toContain(zh("account.unavailable"));
    expect(container.textContent).not.toContain(zh("account.loginRequired"));
    expect(container.querySelector("form")).toBeNull();
    const retry = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === zh("account.retry"),
    );
    if (retry === undefined) throw new Error("missing retry button");
    await act(async () => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(attempts).toBe(2);
    expect(container.querySelector("form")).not.toBeNull();
    cleanup(root, container);
  });
});
