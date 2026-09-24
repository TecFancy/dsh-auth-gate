// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeT(dict: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string =>
    formatCopy(dict[key] ?? key, params);
}

const zh = makeT(ACCOUNT_DICT_ZH);

async function render(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsAccountSection, { t: zh }));
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

/** HTMLInputElement.prototype 的原生 value setter（属性形，避免 unbound-method）。 */
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

/** 契约 §1 第 9 行：503 是 text/plain，json() 必须失败。 */
function textResponse(status: number): unknown {
  return { ok: false, status, json: () => Promise.reject(new Error("not json")) };
}

function routeFetch(handler: (url: string) => unknown): void {
  fetchMock.mockImplementation((input: unknown) => Promise.resolve(handler(String(input))));
}

interface ErrorCase {
  name: string;
  respond: () => unknown;
  message: string;
  field: string | null;
  rules?: string[];
}

/** 契约 §1 响应矩阵的客户端映射用例（含不自造错误码的兜底行）。 */
const ERROR_CASES: ErrorCase[] = [
  {
    name: "401 invalid_credentials",
    respond: () => jsonResponse(401, { error: "invalid_credentials" }),
    message: "当前密码不正确",
    field: "current",
  },
  {
    name: "401 invalid_totp",
    respond: () => jsonResponse(401, { error: "invalid_totp" }),
    message: "该验证码已被使用",
    field: "code",
  },
  {
    name: "400 policy + rules",
    respond: () => jsonResponse(400, { error: "policy", rules: ["minLength", "digit", "mystery"] }),
    message: "新密码不符合以下要求",
    field: "password",
    rules: ["至少 14 个字符", "包含数字", "mystery"],
  },
  {
    name: "429 locked + retryAfter",
    respond: () => jsonResponse(429, { error: "locked", retryAfter: 42 }),
    message: "42 秒后重试",
    field: null,
  },
  {
    name: "429 locked without retryAfter",
    respond: () => jsonResponse(429, { error: "locked" }),
    message: "尝试次数过多，请稍后重试",
    field: null,
  },
  {
    name: "503 text/plain",
    respond: () => textResponse(503),
    message: "服务暂时不可用",
    field: null,
  },
  {
    name: "network failure",
    respond: () => Promise.reject(new Error("network")),
    message: "修改失败，请稍后重试",
    field: null,
  },
  {
    name: "unknown status (no invented code)",
    respond: () => jsonResponse(500, { error: "boom" }),
    message: "修改失败，请稍后重试",
    field: null,
  },
];

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("error mapping per contract 1", () => {
  it.each(ERROR_CASES)("maps $name to its frozen copy and field", async (testCase) => {
    routeFetch((url) => (url === "/auth/status" ? statusOk(true) : testCase.respond()));
    const { root, container } = await render();
    fillValid(container);
    submitForm(container);
    await settle();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain(testCase.message);
    for (const rule of testCase.rules ?? []) expect(status?.textContent).toContain(rule);
    for (const name of ["current", "password", "confirm", "code"]) {
      const input = inputByName(container, name);
      expect(input.getAttribute("aria-invalid")).toBe(name === testCase.field ? "true" : null);
    }
    const describedBy = inputByName(container, testCase.field ?? "current").getAttribute(
      "aria-describedby",
    );
    if (testCase.field === null) expect(describedBy).toBeNull();
    else expect(describedBy).toContain("dsh-auth-gate-account-status");
    cleanup(root, container);
  });
});

describe("client-side validation before the POST", () => {
  it.each([
    {
      name: "current password",
      field: "current",
      values: { current: "", password: "NewPassw0rd", confirm: "NewPassw0rd" },
      message: "请输入当前密码",
    },
    {
      name: "new password",
      field: "password",
      values: { current: "old pass", password: "", confirm: "" },
      message: "请输入新密码",
    },
  ])("rejects an empty $name without sending a request", async (testCase) => {
    const posts: string[] = [];
    routeFetch((url) => {
      posts.push(url);
      return statusOk(true);
    });
    const { root, container } = await render();
    setValue(container, "current", testCase.values.current);
    setValue(container, "password", testCase.values.password);
    setValue(container, "confirm", testCase.values.confirm);
    submitForm(container);
    await settle();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(testCase.message);
    expect(inputByName(container, testCase.field).getAttribute("aria-invalid")).toBe("true");
    expect(posts.filter((url) => url === "/auth/password")).toHaveLength(0);
    cleanup(root, container);
  });

  it("rejects a confirm mismatch on the client without sending a request", async () => {
    const posts: string[] = [];
    routeFetch((url) => {
      posts.push(url);
      return statusOk(true);
    });
    const { root, container } = await render();
    fillValid(container);
    setValue(container, "confirm", "NewPassw0rd2");
    submitForm(container);
    await settle();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "两次输入的新密码不一致",
    );
    expect(inputByName(container, "confirm").getAttribute("aria-invalid")).toBe("true");
    expect(posts.filter((url) => url === "/auth/password")).toHaveLength(0);
    cleanup(root, container);
  });
});
