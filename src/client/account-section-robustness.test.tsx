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

function routeFetch(handler: (url: string, init: RequestInit) => unknown): void {
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
}

/** 挂起中的响应：由测试决定何时放行。 */
function deferred(): { promise: Promise<unknown>; release: (value: unknown) => void } {
  let release: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((resolve) => {
    release = (value) => resolve(value);
  });
  return { promise, release };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("submit locking", () => {
  it("locks double submission while the first POST is still in flight", async () => {
    const posts: string[] = [];
    const pending = deferred();
    routeFetch((url) => {
      posts.push(url);
      return url === "/auth/status" ? statusOk(true) : pending.promise;
    });
    const { root, container } = await render();
    fillValid(container);
    submitForm(container);
    submitForm(container);
    expect(posts.filter((url) => url === "/auth/password")).toHaveLength(1);
    expect(container.querySelector("button[type=submit]")?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    pending.release(jsonResponse(200, { ok: true }));
    await settle();
    expect(container.textContent).toContain("密码已改，请重新登录");
    cleanup(root, container);
  });
});

describe("unmount safety", () => {
  it("aborts the in-flight request on unmount and ignores the late response", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const json = vi.fn(() => Promise.resolve({ error: "invalid_credentials" }));
    const pending = deferred();
    routeFetch((url, init) => {
      if (url === "/auth/status") return statusOk(true);
      signals.push(init.signal);
      return pending.promise;
    });
    const { root, container } = await render();
    fillValid(container);
    submitForm(container);
    expect(signals[0]?.aborted).toBe(false);
    act(() => {
      root.unmount();
    });
    expect(signals[0]?.aborted).toBe(true);
    pending.release({ ok: false, status: 401, json });
    await flushMicrotasks();
    expect(json).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});

describe("IME composition guard", () => {
  it("does not submit while an IME composition is active, but submits once it ends", async () => {
    const posts: string[] = [];
    routeFetch((url) => {
      posts.push(url);
      return url === "/auth/status" ? statusOk(true) : jsonResponse(200, { ok: true });
    });
    const { root, container } = await render();
    fillValid(container);
    const input = inputByName(container, "password");
    act(() => {
      input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    });
    let accepted = true;
    act(() => {
      accepted = input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
    });
    expect(accepted).toBe(false);
    submitForm(container);
    expect(posts.filter((url) => url === "/auth/password")).toHaveLength(0);
    act(() => {
      input.dispatchEvent(new Event("compositionend", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(posts.filter((url) => url === "/auth/password")).toHaveLength(1);
    cleanup(root, container);
  });
});
