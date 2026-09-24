// @vitest-environment jsdom
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";
import { ADMIN_DICT_ZH, ADMIN_KEYS } from "./admin-copy.ts";
import { AdminResetForm } from "./admin-form.tsx";
import type { AdminUserRow } from "./admin-types.ts";

/**
 * grok **实现期评审必修项**的回归测试（lead 所有）。这里只放"修完必须不再犯"的键位/键序行为，
 * 正常运行路径的覆盖在 `admin-form.test.tsx` / `admin-block.test.tsx` / `admin-api.test.ts`。
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const t = (key: string, params?: Record<string, unknown>): string =>
  formatCopy({ ...ACCOUNT_DICT_ZH, ...ADMIN_DICT_ZH }[key] ?? key, params);

const USERS: AdminUserRow[] = [
  { name: "admin", role: "admin", disabled: false, totpEnabled: false, mustChangePassword: false },
  { name: "alice", role: "user", disabled: false, totpEnabled: false, mustChangePassword: false },
];

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function jsonResponse(status: number, body: unknown): unknown {
  return { ok: status < 400, status, json: () => Promise.resolve(body) };
}

/** 挂载任意元素（含 StrictMode 包装）到独立容器。 */
async function mountInto(
  element: ReactElement,
): Promise<{ container: HTMLElement; unmount: () => void }> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
    await flushMicrotasks();
  });
  return { container, unmount: () => act(() => root.unmount()) };
}

async function render(): Promise<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(AdminResetForm, {
        t,
        users: USERS,
        actorName: "admin",
        actorTotpEnabled: false,
      }),
    );
    await flushMicrotasks();
  });
  return { root, container };
}

/** React 受控组件：原生 setter 改值 + 派发 input/change。 */
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  for (const type of ["input", "change"]) element.dispatchEvent(new Event(type, { bubbles: true }));
}

describe("grok 实现期评审必修项回归", () => {
  it("下拉里的 Enter 只确认选项，不提交表单（回顾 #5）", async () => {
    const { container } = await render();
    const select = container.querySelector<HTMLSelectElement>("#dsh-auth-gate-admin-target");
    if (select === null) throw new Error("missing target select");
    await act(async () => {
      setValue(select, "alice");
      setValue(
        container.querySelector<HTMLInputElement>("#dsh-auth-gate-admin-password")!,
        "NewPassw0rd!XY",
      );
      setValue(
        container.querySelector<HTMLInputElement>("#dsh-auth-gate-admin-confirm")!,
        "NewPassw0rd!XY",
      );
      await flushMicrotasks();
    });
    await act(async () => {
      select.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await flushMicrotasks();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("#dsh-auth-gate-admin-status")?.textContent).toBe("");
    // 对照：表单级 Enter（焦点不在下拉）仍按契约提交，证明上一条不是"整个表单失效"。
    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/auth/users/password");
  });
});

describe("reviewer 只读复审回归（R1 / R4）", () => {
  it("StrictMode 双挂载后仍能落成功态、清空字段并解锁按钮（reviewer R1）", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, sessionsRevoked: true }));
    const { container, unmount } = await mountInto(
      createElement(
        StrictMode,
        null,
        createElement(AdminResetForm, {
          t,
          users: USERS,
          actorName: "admin",
          actorTotpEnabled: false,
        }),
      ),
    );
    const field = (id: string): HTMLInputElement =>
      container.querySelector<HTMLInputElement>(`#dsh-auth-gate-admin-${id}`)!;
    await act(async () => {
      setValue(container.querySelector<HTMLSelectElement>("#dsh-auth-gate-admin-target")!, "alice");
      setValue(field("password"), "NewPassw0rd!XY");
      setValue(field("confirm"), "NewPassw0rd!XY");
      await flushMicrotasks();
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    // 只写清理、不重挂载时置 true 的旧实现：三行断言全红（提交结果被丢弃 + 按钮永久 disabled）。
    expect(container.textContent).toContain(t(ADMIN_KEYS.successRevoked));
    expect(field("password").value).toBe("");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
    unmount();
  });

  it("没有 t seat 时用英文兜底词典渲染管理块，不显示键名（reviewer R4）", async () => {
    fetchMock.mockImplementation((url: string) => {
      const path = new URL(String(url), "http://x").pathname;
      if (path === "/auth/status") {
        return Promise.resolve(
          jsonResponse(200, {
            authenticated: true,
            name: "admin",
            role: "admin",
            disabled: false,
            totpEnabled: false,
            sessionKind: "full",
            logoutOrder: 1000,
          }),
        );
      }
      if (path === "/auth/users") return Promise.resolve(jsonResponse(200, { users: USERS }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const { container, unmount } = await mountInto(createElement(SettingsAccountSection, {}));
    expect(container.textContent).toContain("User management");
    expect(container.textContent).not.toContain(ADMIN_KEYS.title);
    unmount();
  });
});
