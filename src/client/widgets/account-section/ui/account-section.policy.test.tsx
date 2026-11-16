/**
 * 「账号安全」设置页的两组补充用例：宿主 props 语义与 passkey-only 策略提示。
 *
 * 主文件 `account-section.test.tsx` 覆盖渲染门与提交流程；这里放「旧服务端兼容」与
 * 「`passkey: "required"` 下改密表单仍在、但要说清它不能用来登录」这两类断言。
 *
 * 夹具是自包含的（不抽到 `test/`）：`tsconfig.client.json` 只 include `src/client`，
 * 放在 `test/` 下的 .tsx 拿不到 DOM lib。
 */
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, formatCopy } from "../../../shared/i18n/index.ts";
import { SettingsAccountSection } from "./account-section.tsx";

const redirectApi = vi.hoisted(() => ({
  redirectToLogin: vi.fn(),
}));
vi.mock("../../../features/change-password/lib/account-redirect.ts", () => ({
  LOGIN_REDIRECT_URL: "/auth/login?next=%2F&notice=password-changed",
  ...redirectApi,
}));

vi.mock("./admin-block.tsx", async () => {
  const { createElement: h } = await import("react");
  return { AdminUsersBlock: () => h("div", { "data-testid": "admin-block" }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeT(dict: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string =>
    formatCopy(dict[key] ?? key, params);
}

const zh = makeT(ACCOUNT_DICT_ZH);
const en = makeT(ACCOUNT_DICT_EN);

async function render(props: { t?: typeof zh; [key: string]: unknown }): Promise<{
  root: Root;
  container: HTMLDivElement;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsAccountSection, props));
    await flushMicrotasks();
  });
  return { root, container };
}

async function settle(): Promise<void> {
  await act(async () => {
    await flushMicrotasks();
  });
}

function cleanup(root: Root, container: HTMLElement): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function inputByName(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`missing input[name=${name}]`);
  return input;
}

interface NativeValueSetter {
  set: (this: HTMLInputElement, value: string) => void;
}

function setValue(container: HTMLElement, name: string, value: string): void {
  const input = inputByName(container, name);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") as
    NativeValueSetter | undefined;
  if (descriptor === undefined) throw new Error("HTMLInputElement value setter missing");
  act(() => {
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fillValid(container: HTMLElement): void {
  setValue(container, "current", "old pass");
  setValue(container, "password", "NewPassw0rd");
  setValue(container, "confirm", "NewPassw0rd");
  setValue(container, "code", "123456");
}

function submitForm(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (form === null) throw new Error("missing form");
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function statusOk(authenticated: boolean): unknown {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ authenticated, logoutOrder: 1000 }),
  };
}

function jsonResponse(status: number, body: unknown): unknown {
  return { ok: status === 200, status, json: () => Promise.resolve(body) };
}

function routeFetch(handler: (url: string, init: RequestInit) => unknown): void {
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  for (const fn of Object.values(redirectApi)) fn.mockReset();
});

describe("SettingsAccountSection host props", () => {
  it("ignores the host close prop after success (去向由会话状态决定，不是关弹窗)", async () => {
    const close = vi.fn();
    routeFetch((url) =>
      url === "/auth/status" ? statusOk(true) : jsonResponse(200, { ok: true }),
    );
    const { root, container } = await render({ t: zh, close });
    fillValid(container);
    submitForm(container);
    await settle();
    const relogin = container.querySelector("button");
    expect(relogin?.textContent).toBe("重新登录");
    act(() => {
      relogin?.click();
    });
    expect(close).not.toHaveBeenCalled();
    expect(redirectApi.redirectToLogin).toHaveBeenCalledTimes(2); // 成功时一次 + 手动点一次
    cleanup(root, container);
  });

  it("renders no admin block for an old server that omits the identity fields", async () => {
    const urls: string[] = [];
    routeFetch((url) => {
      urls.push(url);
      return statusOk(true); // 只有 authenticated/logoutOrder（PR2 之前的服务端）
    });
    const { root, container } = await render({ t: zh });
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.querySelector('[data-testid="admin-block"]')).toBeNull();
    expect(urls).toEqual(["/auth/status"]);
    cleanup(root, container);
  });
});

describe("SettingsAccountSection passkey-only notice", () => {
  /** 带 `passwordLoginDisabled` 的已登录响应。 */
  function statusPasskeyOnly(): unknown {
    return {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          authenticated: true,
          logoutOrder: 1000,
          passkeyEnabled: true,
          passwordLoginDisabled: true,
        }),
    };
  }

  it("explains that the password cannot be used to sign in", async () => {
    routeFetch(() => statusPasskeyOnly());
    const { root, container } = await render({ t: zh });
    expect(container.textContent).toContain("本实例要求使用通行密钥登录");
    // 改密表单仍在：口令继续作为管理再认证的秘密。
    expect(container.querySelector('input[name="current"]')).not.toBeNull();
    cleanup(root, container);
  });

  it("renders the English notice for the English dictionary", async () => {
    routeFetch(() => statusPasskeyOnly());
    const { root, container } = await render({ t: en });
    expect(container.textContent).toContain("This instance requires a passkey to sign in");
    cleanup(root, container);
  });

  it("stays silent when the server does not report the flag", async () => {
    routeFetch(() => statusOk(true));
    const { root, container } = await render({ t: zh });
    expect(container.textContent).not.toContain("本实例要求使用通行密钥登录");
    cleanup(root, container);
  });
});
