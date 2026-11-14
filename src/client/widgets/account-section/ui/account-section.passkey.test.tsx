// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_EN, PASSKEY_KEYS, translateFrom } from "../../../shared/i18n/index.ts";
import { SettingsAccountSection } from "./account-section.tsx";

/**
 * passkey 区块的挂载门（M6 PR3）：只有 `/auth/status` 明确回 `passkeyEnabled: true` 才挂块。
 *
 * 关闭（默认配置）与旧服务端（缺字段）都必须**零请求**：端点根本不存在，挂了只会显示
 * 「暂时不可用」，与「非 admin 不试拉管理面」同一纪律。
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = translateFrom(ACCOUNT_DICT_EN);
const fetchMock = vi.fn();
const requests: [string, RequestInit | undefined][] = [];

beforeEach(() => {
  requests.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

/** 按 pathname 路由：status 走给定 body，passkey 列表走空列表。 */
function mockApi(status: unknown): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    requests.push([url, init]);
    if (url === "/auth/status") return Promise.resolve(jsonResponse(status));
    if (url === "/auth/passkey") return Promise.resolve(jsonResponse({ passkeys: [] }));
    if (url === "/auth/passkey/settings") {
      return Promise.resolve(jsonResponse({ conditionalUiEnabled: false }));
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
}

async function render(): Promise<{ root: Root; container: HTMLDivElement }> {
  document.body.innerHTML = "";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsAccountSection, { t: T }));
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

function paths(): string[] {
  return requests.map(([url]) => url);
}

const FULL = {
  authenticated: true,
  name: "alice",
  role: "user",
  disabled: false,
  totpEnabled: false,
  sessionKind: "full",
  logoutOrder: 1000,
};

describe("SettingsAccountSection: passkey block gate", () => {
  it("mounts the block and requests the list when the server reports passkeyEnabled", async () => {
    mockApi({ ...FULL, passkeyEnabled: true });
    const { root, container } = await render();
    expect(container.textContent).toContain(T(PASSKEY_KEYS.title));
    expect(paths()).toContain("/auth/passkey");
    cleanup(root, container);
  });

  it("renders no block and makes no passkey request when passkeyEnabled is false", async () => {
    mockApi({ ...FULL, passkeyEnabled: false });
    const { root, container } = await render();
    expect(container.textContent).not.toContain(T(PASSKEY_KEYS.title));
    expect(paths()).toEqual(["/auth/status"]);
    cleanup(root, container);
  });

  it("treats a missing passkeyEnabled (old server) as unknown, not as enabled", async () => {
    mockApi(FULL);
    const { root, container } = await render();
    expect(container.textContent).not.toContain(T(PASSKEY_KEYS.title));
    expect(paths()).toEqual(["/auth/status"]);
    cleanup(root, container);
  });

  it("keeps the password form available in every case", async () => {
    for (const status of [
      { ...FULL, passkeyEnabled: true },
      { ...FULL, passkeyEnabled: false },
      FULL,
    ]) {
      mockApi(status);
      const { root, container } = await render();
      expect(container.querySelector("form")).not.toBeNull();
      cleanup(root, container);
    }
  });

  it("mounts the admin settings toggle only for a full admin session", async () => {
    mockApi({ ...FULL, role: "admin", passkeyEnabled: true });
    const { root, container } = await render();
    expect(container.textContent).toContain(T(PASSKEY_KEYS.settingsTitle));
    cleanup(root, container);

    mockApi({ ...FULL, role: "user", passkeyEnabled: true });
    const second = await render();
    expect(second.container.textContent).not.toContain(T(PASSKEY_KEYS.settingsTitle));
    cleanup(second.root, second.container);
  });
});
