// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSKEY_DICT_EN, PASSKEY_KEYS, translateFrom } from "../../../shared/i18n/index.ts";
import { PasskeyBlock } from "./passkey-block.tsx";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
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
  // 默认：支持 WebAuthn（列表与添加表单都渲染）。
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

/** 路由式 fetch mock：`/auth/passkey` 走列表，其余按 handler 决定。 */
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

describe("PasskeyBlock: 列表", () => {
  it("renders the title, intro and one row per credential", async () => {
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    expect(container.querySelector("h3")?.textContent).toBe(t(PASSKEY_KEYS.title));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.intro));
    expect(container.textContent).toContain("MacBook Touch ID");
    expect(container.textContent).toContain("2023-11-14");
    expect(container.textContent).toContain(t(PASSKEY_KEYS.neverUsed));
    expect(container.textContent).toContain(t(PASSKEY_KEYS.backupEligible));
    expect(container.textContent).toContain("internal");
    cleanup(root, container);
  });

  it("shows the empty state when the list is empty", async () => {
    mockList(200, { passkeys: [] });
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.empty));
    expect(container.querySelector("table")).toBeNull();
    cleanup(root, container);
  });

  it("shows the loading copy before the list resolves", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.loading));
    cleanup(root, container);
  });

  it("shows the unavailable copy when the list request fails", async () => {
    mockList(503, {});
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.unavailable));
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
});

describe("PasskeyBlock: 特性检测", () => {
  it("hides the add form when PublicKeyCredential is missing but keeps the list", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    mockList(200, { passkeys: [SUMMARY] });
    const { root, container } = await render();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.unsupported));
    expect(container.textContent).toContain("MacBook Touch ID");
    cleanup(root, container);
  });
});

describe("PasskeyBlock: 表单校验", () => {
  it("blocks an empty label without sending a request", async () => {
    mockList(200, { passkeys: [] });
    const { root, container } = await render();
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
    setValue(container, "label", "MacBook");
    submitForm(container);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(container.textContent).toContain(t(PASSKEY_KEYS.passwordRequired));
    cleanup(root, container);
  });
});

describe("PasskeyBlock: 删除", () => {
  it("posts the id prefix and reloads the list after a successful removal", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      if (url === "/auth/passkey/remove") return Promise.resolve(jsonResponse(200, {}));
      return Promise.resolve(jsonResponse(200, { passkeys: [SUMMARY] }));
    });
    const { root, container } = await render();
    const listsBefore = requests.filter(([url]) => url === "/auth/passkey").length;
    const removeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t(PASSKEY_KEYS.remove),
    );
    expect(removeButton).toBeDefined();
    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
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
    const removeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t(PASSKEY_KEYS.remove),
    );
    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(container.textContent).toContain(t(PASSKEY_KEYS.notFound));
    cleanup(root, container);
  });
});
