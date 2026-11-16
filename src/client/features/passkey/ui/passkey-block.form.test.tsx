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

function submitForm(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (form === null) throw new Error("missing form");
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/**
 * 展开添加表单（重设计：默认收起）。
 *
 * 空态时触发按钮的文案是「添加第一把通行密钥」，有凭据时是「添加通行密钥」，
 * 两种都要认。
 */
async function openAddForm(container: HTMLElement): Promise<void> {
  const trigger = [...container.querySelectorAll("button")].find(
    (item) =>
      item.textContent === t(PASSKEY_KEYS.add) || item.textContent === t(PASSKEY_KEYS.emptyAction),
  );
  if (trigger === undefined) throw new Error("missing add trigger");
  await click(trigger);
}

describe("PasskeyBlock: 表单校验", () => {
  it("blocks an empty label without sending a request", async () => {
    mockList(200, { passkeys: [] });
    const { root, container } = await render();
    await openAddForm(container);
    const before = requests.length;
    setValue(container, "password", "pw");
    submitForm(container);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(container.textContent).toContain(t(PASSKEY_KEYS.labelRequired));
    expect(requests.length).toBe(before);
    cleanup(root, container);
  });

  it("blocks a label longer than 64 characters", async () => {
    mockList(200, { passkeys: [] });
    const { root, container } = await render();
    await openAddForm(container);
    setValue(container, "label", "x".repeat(65));
    setValue(container, "password", "pw");
    submitForm(container);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(container.textContent).toContain(t(PASSKEY_KEYS.labelTooLong));
    cleanup(root, container);
  });

  it("blocks an empty password", async () => {
    mockList(200, { passkeys: [] });
    const { root, container } = await render();
    await openAddForm(container);
    setValue(container, "label", "MacBook");
    submitForm(container);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(container.textContent).toContain(t(PASSKEY_KEYS.passwordRequired));
    cleanup(root, container);
  });

  it("clears the error as soon as the field is edited", async () => {
    mockList(200, { passkeys: [] });
    const { root, container } = await render();
    await openAddForm(container);
    submitForm(container);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(container.textContent).toContain(t(PASSKEY_KEYS.labelRequired));
    setValue(container, "label", "MacBook");
    expect(container.textContent).not.toContain(t(PASSKEY_KEYS.labelRequired));
    cleanup(root, container);
  });
});
