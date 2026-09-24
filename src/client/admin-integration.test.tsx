// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_KEYS, translateFrom } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";
import { ADMIN_DICT_EN, ADMIN_KEYS } from "./admin-copy.ts";
import type { AuthContext } from "./context.ts";
import { apply } from "./index.tsx";

/**
 * PR2 集成测试（lead 所有，契约 §5 第 4 条）：**真** `SettingsAccountSection` + **真**
 * `AdminUsersBlock`/`AdminResetForm`，只 mock `fetch`。各写者的单元测试覆盖自己的分支，
 * 这里证明"接线 + 门 + 端到端提交"三者合起来的事实：
 * admin 全链（列用户 → 提交重置 → 清空字段 → 重拉列表）、非 admin 零管理请求、
 * 受限会话/禁用 admin/旧服务端不挂块、以及 `apply` 真把 ADMIN 词典合并进 `auth` 命名域。
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
/** 每次请求的 url/init（不用 mock.calls 的 any 值，保持类型安全）。 */
const requests: [string, RequestInit | undefined][] = [];

/** 与 `index.tsx` 的注册等价：同一 `auth` 命名域合并两套词典 + 英文兜底。 */
const T = translateFrom({ ...ACCOUNT_DICT_EN, ...ADMIN_DICT_EN });

const ADMIN_STATUS = {
  authenticated: true,
  name: "boss",
  role: "admin",
  disabled: false,
  totpEnabled: false,
  sessionKind: "full",
  logoutOrder: 1000,
};

/** 服务端已按 name 排序：boss(admin) 在前，worker 在后；worker 带 must_change_password。 */
const USERS_BODY = {
  users: [
    { name: "boss", role: "admin", disabled: false, totpEnabled: false, mustChangePassword: false },
    { name: "worker", role: "user", disabled: false, totpEnabled: false, mustChangePassword: true },
  ],
};

function jsonResponse(body: unknown, status = 200): unknown {
  return { ok: status < 400, status, json: () => Promise.resolve(body) };
}

function pathOf(url: string): string {
  return new URL(url, "http://x").pathname;
}

/** 按 pathname + method 路由的 fetch mock；`status` 可换成非 admin / 受限 / 旧服务端形状。 */
function mockApi(status: unknown): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    requests.push([url, init]);
    const path = pathOf(url);
    if (path === "/auth/status") return Promise.resolve(jsonResponse(status));
    if (path === "/auth/users" && init?.method !== "POST") {
      return Promise.resolve(jsonResponse(USERS_BODY));
    }
    if (path === "/auth/users/password") {
      return Promise.resolve(jsonResponse({ ok: true, sessionsRevoked: true }));
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
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

/** React 受控组件：绕过 React 的 value tracker，用原型 setter 写值再派发原生事件。 */
async function change(container: HTMLElement, selector: string, value: string): Promise<void> {
  const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (element === null) throw new Error(`missing control: ${selector}`);
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await flushMicrotasks();
  });
}

async function submit(container: HTMLElement): Promise<void> {
  // 面板里有两个表单（自助改密 + 管理重置）：用管理块自己的字段定位，别抓到第一个。
  const form = container.querySelector("#dsh-auth-gate-admin-target")?.closest("form") ?? null;
  if (form === null) throw new Error("missing admin form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();
  });
}

function pathSet(): Set<string> {
  return new Set(requests.map(([url]) => pathOf(url)));
}

function listCalls(): number {
  return requests.filter(([url, init]) => pathOf(url) === "/auth/users" && init?.method !== "POST")
    .length;
}

function resetCall(): [string, RequestInit | undefined] | undefined {
  return requests.find(([url]) => pathOf(url) === "/auth/users/password");
}

function adminTitle(container: HTMLElement): Element | null {
  return container.querySelector("#dsh-auth-gate-admin-title");
}

function valueOf(container: HTMLElement, selector: string): string | undefined {
  return container.querySelector<HTMLInputElement>(selector)?.value;
}

beforeEach(() => {
  requests.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin panel integration (real section + real block)", () => {
  it("admin full session: lists users, resets another user, clears the form and reloads the list", async () => {
    mockApi(ADMIN_STATUS);
    const { root, container } = await render(createElement(SettingsAccountSection, { t: T }));
    expect(adminTitle(container)?.textContent).toBe(T(ADMIN_KEYS.title));
    // 下拉排除本人 + 空初始占位（A5）：只剩 worker，且默认不预选。
    expect(
      [...container.querySelectorAll("#dsh-auth-gate-admin-target option")].map(
        (option) => option.textContent,
      ),
    ).toEqual([T(ADMIN_KEYS.targetPlaceholder), "worker"]);
    expect(valueOf(container, "#dsh-auth-gate-admin-target")).toBe("");
    // actor 未开 TOTP → 不渲染 code 输入框（§3.7）。
    expect(container.querySelector("#dsh-auth-gate-admin-code")).toBeNull();
    expect(
      container.querySelector("#dsh-auth-gate-admin-password")?.getAttribute("autocomplete"),
    ).toBe("new-password");

    await change(container, "#dsh-auth-gate-admin-target", "worker");
    await change(container, "#dsh-auth-gate-admin-password", "Str0ng-Passw0rd!");
    await change(container, "#dsh-auth-gate-admin-confirm", "Str0ng-Passw0rd!");
    // A7 断言必须在"提交之前"取快照：StrictMode 首挂载本身就可能已经打出 2 次列表请求，
    // 用绝对值（>=2）会在 A7 坏掉时依旧变绿。
    const listsBeforeSubmit = listCalls();
    await submit(container);

    const call = resetCall();
    expect(call).toBeDefined();
    const headers = call?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(headers?.["Origin"]).toBeUndefined();
    const raw = call?.[1]?.body;
    const body = raw instanceof URLSearchParams ? raw : new URLSearchParams();
    expect(body.get("target")).toBe("worker");
    expect(body.get("password")).toBe("Str0ng-Passw0rd!");
    expect(body.has("confirm")).toBe(false);
    expect(body.has("code")).toBe(false);
    // 成功：就地文案 + 四字段清空 + A7 重拉列表（徽标刷新）。
    expect(container.textContent).toContain(T(ADMIN_KEYS.successRevoked));
    expect(valueOf(container, "#dsh-auth-gate-admin-target")).toBe("");
    expect(valueOf(container, "#dsh-auth-gate-admin-password")).toBe("");
    expect(valueOf(container, "#dsh-auth-gate-admin-confirm")).toBe("");
    expect(listCalls()).toBeGreaterThan(listsBeforeSubmit);
    cleanup(root, container);
  });

  it.each([
    ["non-admin", { ...ADMIN_STATUS, name: "worker", role: "user" }],
    ["restricted session", { ...ADMIN_STATUS, sessionKind: "password-change-only" }],
    ["disabled admin", { ...ADMIN_STATUS, disabled: true }],
    ["legacy server", { authenticated: true, logoutOrder: 1000 }],
    ["partial additive fields", { authenticated: true, name: "boss", role: "admin" }],
  ])("never renders the block and never requests the list: %s", async (_label, status) => {
    mockApi(status);
    const { root, container } = await render(createElement(SettingsAccountSection, { t: T }));
    // 自助改密表单仍在（登录态由 status.authenticated 决定，与角色无关）。
    expect(container.textContent).toContain(T(ACCOUNT_KEYS.title));
    expect(adminTitle(container)).toBeNull();
    expect(pathSet()).toEqual(new Set(["/auth/status"]));
    cleanup(root, container);
  });
});

describe("apply dictionary merge", () => {
  it("registers every admin key in both locales inside the auth namespace", () => {
    const localeRegisters: [string, string, Record<string, string>][] = [];
    const ctx = {
      slots: {
        register: vi.fn(() => () => undefined),
        inject: vi.fn(() => () => undefined),
      },
      locale: {
        register: vi.fn((ns: string, loc: string, dict: Record<string, string>) => {
          localeRegisters.push([ns, loc, dict]);
          return () => undefined;
        }),
        bind: vi.fn(() => (key: string) => key),
      },
      effect: vi.fn((setup: () => (() => void) | Iterable<() => void>) => {
        setup();
      }),
    } as unknown as AuthContext;
    apply(ctx);
    const byLocale = new Map(localeRegisters.map(([, loc, dict]) => [loc, dict]));
    const zh = byLocale.get("zh");
    const en = byLocale.get("en");
    expect(zh).toBeDefined();
    expect(en).toBeDefined();
    // 合并没覆盖旧键：登出与自助改密键仍在同一命名域。
    expect(zh?.["logout"]).toBe("退出登录");
    expect(zh?.[ACCOUNT_KEYS.title]).toBe("修改密码");
    for (const key of Object.values(ADMIN_KEYS)) {
      expect(zh?.[key]?.length).toBeGreaterThan(0);
      expect(en?.[key]?.length).toBeGreaterThan(0);
    }
    expect(Object.keys(zh ?? {}).length).toBe(Object.keys(en ?? {}).length);
  });
});
