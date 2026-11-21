// @vitest-environment jsdom
/**
 * 通行密钥区块（重设计 2026-11-16）。
 *
 * 与旧版的差别在**点击路径**：添加表单默认收起（先点「添加通行密钥」），删除要先点
 * 行内「删除」展开确认区、填再认证口令、再点「确认删除」才发请求。这些不是测试噪音，
 * 正是这次重设计要保证的行为（破坏性动作不能一次误点就执行）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSKEY_DICT_EN, PASSKEY_KEYS, translateFrom } from "../../../shared/i18n/index.ts";
import { PasskeyBlock } from "./passkey-block.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = translateFrom(PASSKEY_DICT_EN);
const fetchMock = vi.fn();
const requests: [string, RequestInit | undefined][] = [];

const SUMMARY = {
  idPrefix: "abcdefghijkl",
  label: "MacBook Touch ID",
  createdAt: 1_700_000_000_000,
  lastUsedAt: 0,
  backupEligible: true,
  backupState: false,
  transports: ["internal"],
};

beforeEach(() => {
  requests.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
  Object.defineProperty(globalThis.navigator, "credentials", {
    configurable: true,
    value: { create: () => Promise.resolve(null) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis.navigator, "credentials");
  document.body.innerHTML = "";
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function mockList(status: number, body: unknown): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    requests.push([url, init]);
    return Promise.resolve(jsonResponse(status, body));
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function render(): Promise<{ root: Root; container: HTMLDivElement }> {
  document.body.innerHTML = "";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PasskeyBlock, { t }));
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

/** 按可见文本找按钮（重设计后同一屏有多个按钮，按文本区分最稳）。 */
function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  if (button === undefined) throw new Error(`missing button: ${text}`);
  return button;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
  });
}

function inputByName(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`missing input[name=${name}]`);
  return input;
}

function setValue(container: HTMLElement, name: string, value: string): void {
  const input = inputByName(container, name);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  act(() => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * 展开添加表单（重设计：默认收起）。
 *
 * 空态时触发按钮的文案是「添加第一把通行密钥」，有凭据时是「添加通行密钥」，
 * 两种都要认。
 */
describe("PasskeyBlock: 删除", () => {
  it("does not send a request when the remove button is pressed", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    const before = requests.length;
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    // 只展开确认区，不发请求：破坏性动作不能一次误点就执行。
    expect(requests.length).toBe(before);
    expect(container.textContent).toContain(t(PASSKEY_KEYS.removeTitle, { label: SUMMARY.label }));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.removeWarning));
    cleanup(root, container);
  });

  it("requires the current password before confirming", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    const before = requests.length;
    await click(buttonByText(container, t(PASSKEY_KEYS.removeConfirm)));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.passwordRequired));
    expect(requests.length).toBe(before);
    cleanup(root, container);
  });

  it("posts the id prefix and reloads the list after a confirmed removal", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      if (url === "/auth/passkey/remove") return Promise.resolve(jsonResponse(200, {}));
      return Promise.resolve(jsonResponse(200, { passkeys: [SUMMARY] }));
    });
    const { root, container } = await render();
    const listsBefore = requests.filter(([url]) => url === "/auth/passkey").length;
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    setValue(container, "password", "pw");
    await click(buttonByText(container, t(PASSKEY_KEYS.removeConfirm)));
    const removeCall = requests.find(([url]) => url === "/auth/passkey/remove");
    expect(removeCall).toBeDefined();
    const body = removeCall?.[1]?.body;
    expect(body instanceof URLSearchParams ? body.get("id") : undefined).toBe("abcdefghijkl");
    expect(container.textContent).toContain(t(PASSKEY_KEYS.successRemove));
    expect(requests.filter(([url]) => url === "/auth/passkey").length).toBeGreaterThan(listsBefore);
    cleanup(root, container);
  });

  it("shows the failure copy when removal is rejected", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      if (url === "/auth/passkey/remove") {
        return Promise.resolve(jsonResponse(404, { error: "not_found" }));
      }
      return Promise.resolve(jsonResponse(200, { passkeys: [SUMMARY] }));
    });
    const { root, container } = await render();
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    setValue(container, "password", "pw");
    await click(buttonByText(container, t(PASSKEY_KEYS.removeConfirm)));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.notFound));
    cleanup(root, container);
  });

  it("cancels the confirmation and clears the re-auth value", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    setValue(container, "password", "secret");
    await click(buttonByText(container, t(PASSKEY_KEYS.cancel)));
    expect(container.textContent).not.toContain(t(PASSKEY_KEYS.removeWarning));
    // 重新展开时口令框是空的：上一份再认证值不能残留。
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    expect(inputByName(container, "password").value).toBe("");
    cleanup(root, container);
  });
});

describe("PasskeyBlock: 删除（C6 结构 / C3 重拉失败）", () => {
  it("renders the remove form outside the row header, in its own cell (C6)", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.closest("th")).toBeNull();
    expect(form?.closest("td")).not.toBeNull();
    cleanup(root, container);
  });

  it("surfaces a failed list reload after a successful removal and lets retry recover (C3)", async () => {
    let listFetches = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      if (url === "/auth/passkey/remove") return Promise.resolve(jsonResponse(200, {}));
      listFetches += 1;
      // 第 1 次（挂载）成功，第 2 次（删除后重拉）失败，第 3 次（重试）恢复。
      return Promise.resolve(
        listFetches === 2 ? jsonResponse(503, {}) : jsonResponse(200, { passkeys: [SUMMARY] }),
      );
    });
    const { root, container } = await render();
    await click(buttonByText(container, t(PASSKEY_KEYS.remove)));
    setValue(container, "password", "pw");
    await click(buttonByText(container, t(PASSKEY_KEYS.removeConfirm)));

    // 刷新失败不能是 no-op：旧列表撤下，给不可用提示 + 可用的重试。
    expect(container.textContent).toContain(t(PASSKEY_KEYS.successRemove));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.unavailable));
    expect(container.querySelector("table")).toBeNull();

    await click(buttonByText(container, t(PASSKEY_KEYS.retry)));
    expect(container.querySelector("table")).not.toBeNull();
    cleanup(root, container);
  });
});
