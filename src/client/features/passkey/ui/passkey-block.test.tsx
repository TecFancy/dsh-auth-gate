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

describe("PasskeyBlock: 列表", () => {
  it("renders the title, intro, count badge and one row per credential", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    expect(container.querySelector("h3")?.textContent).toBe(t(PASSKEY_KEYS.title));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.intro));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.count, { count: 1 }));
    expect(container.textContent).toContain("MacBook Touch ID");
    expect(container.textContent).toContain(t(PASSKEY_KEYS.neverUsed));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.backupEligible));
    expect(container.textContent).toContain("internal");
    cleanup(root, container);
  });

  it("renders the table with a caption and a row header", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("caption")?.textContent).toBe(t(PASSKEY_KEYS.tableCaption));
    expect(table?.querySelector('th[scope="row"]')?.textContent).toContain("MacBook Touch ID");
    // 五列压成两列：名称（行头）+ 操作。
    expect(table?.querySelectorAll("thead th")).toHaveLength(2);
    cleanup(root, container);
  });

  it("shows the empty state with a next-step action", async () => {
    mockList(200, { passkeys: [] });
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.empty));
    expect(container.querySelector("table")).toBeNull();
    // 空态的主行动是「添加第一把通行密钥」，不是通用的「添加」。
    expect(buttonByText(container, t(PASSKEY_KEYS.emptyAction))).toBeDefined();
    cleanup(root, container);
  });

  it("shows the loading copy before the list resolves", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.loading));
    cleanup(root, container);
  });

  it("shows the unavailable copy and a retry action when the list request fails", async () => {
    mockList(503, {});
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.unavailable));
    expect(buttonByText(container, t(PASSKEY_KEYS.retry))).toBeDefined();
    cleanup(root, container);
  });

  it("shows the session-expired copy on 401", async () => {
    mockList(401, {});
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.unauthorized));
    cleanup(root, container);
  });

  it("renders nothing for the list on 403 (restricted session) but keeps the block", async () => {
    mockList(403, {});
    const { root, container } = await render();
    expect(container.textContent).not.toContain(t(PASSKEY_KEYS.unavailable));
    expect(container.textContent).not.toContain(t(PASSKEY_KEYS.empty));
    expect(container.querySelector("h3")?.textContent).toBe(t(PASSKEY_KEYS.title));
    cleanup(root, container);
  });

  it("offers no add or remove action on 403 (restricted session)", async () => {
    mockList(403, {});
    const { root, container } = await render();
    // 列表被禁止不代表添加被允许：不能让用户填一堆注定 403 的秘密信息。
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    cleanup(root, container);
  });
});

describe("PasskeyBlock: 特性检测", () => {
  it("hides the add entry when PublicKeyCredential is missing but keeps the list", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.unsupported));
    expect(container.textContent).toContain("MacBook Touch ID");
    cleanup(root, container);
  });
});

describe("PasskeyBlock: 添加表单默认收起", () => {
  it("does not render the add form until the trigger is pressed", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    expect(container.querySelector("form")).toBeNull();
    await openAddForm(container);
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.addFormTitle));
    cleanup(root, container);
  });

  it("closes the add form and returns focus to the trigger on cancel", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    await openAddForm(container);
    await click(buttonByText(container, t(PASSKEY_KEYS.cancel)));
    expect(container.querySelector("form")).toBeNull();
    expect(document.activeElement?.textContent).toBe(t(PASSKEY_KEYS.add));
    cleanup(root, container);
  });
});
