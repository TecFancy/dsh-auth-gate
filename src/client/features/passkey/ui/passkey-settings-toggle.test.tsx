// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSKEY_DICT_EN, PASSKEY_KEYS, translateFrom } from "../../../shared/i18n/index.ts";
import { PasskeySettingsToggle } from "./passkey-settings-toggle.tsx";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = translateFrom(PASSKEY_DICT_EN);
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function render(): Promise<{ root: Root; container: HTMLDivElement }> {
  document.body.innerHTML = "";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PasskeySettingsToggle, { t }));
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

function toggleOf(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (input === null) throw new Error("missing checkbox");
  return input;
}

describe("PasskeySettingsToggle", () => {
  it("renders the checkbox with the server value and a label bound to it", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      return Promise.resolve(jsonResponse(200, { conditionalUiEnabled: true }));
    });
    const { root, container } = await render();
    const checkbox = toggleOf(container);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.id).toBe("dsh-auth-gate-passkey-settings-toggle");
    expect(container.querySelector("label")?.getAttribute("for")).toBe(checkbox.id);
    expect(container.textContent).toContain(t(PASSKEY_KEYS.settingsLabel));
    expect(requests[0]?.[0]).toBe("/auth/passkey/settings");
    expect(requests[0]?.[1]?.method).toBe("GET");
    cleanup(root, container);
  });

  it("renders nothing for non-admins (403)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, {})));
    const { root, container } = await render();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toBe("");
    cleanup(root, container);
  });

  it("shows the unavailable copy when the read fails", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(503, {})));
    const { root, container } = await render();
    expect(container.textContent).toContain(t(PASSKEY_KEYS.unavailable));
    cleanup(root, container);
  });

  it("POSTs conditionalUi=1 when checked and shows the saved copy", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse(200, { conditionalUiEnabled: true }));
      }
      return Promise.resolve(jsonResponse(200, { conditionalUiEnabled: false }));
    });
    const { root, container } = await render();
    expect(toggleOf(container).checked).toBe(false);
    await act(async () => {
      toggleOf(container).click();
      await flushMicrotasks();
    });
    const post = requests.find(([, init]) => init?.method === "POST");
    expect(post).toBeDefined();
    const body = post?.[1]?.body;
    expect(body instanceof URLSearchParams ? body.toString() : "").toBe("conditionalUi=1");
    expect(toggleOf(container).checked).toBe(true);
    expect(container.textContent).toContain(t(PASSKEY_KEYS.settingsSaved));
    cleanup(root, container);
  });

  it("keeps the previous value and shows an error when the write fails", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push([url, init]);
      if (init?.method === "POST") return Promise.resolve(jsonResponse(503, {}));
      return Promise.resolve(jsonResponse(200, { conditionalUiEnabled: false }));
    });
    const { root, container } = await render();
    await act(async () => {
      toggleOf(container).click();
      await flushMicrotasks();
    });
    expect(toggleOf(container).checked).toBe(false);
    expect(container.textContent).toContain(t(PASSKEY_KEYS.settingsError));
    cleanup(root, container);
  });
});
