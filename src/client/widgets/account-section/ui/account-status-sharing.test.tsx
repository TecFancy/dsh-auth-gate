// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStatus } from "../../../entities/account/index.ts";

/**
 * C9：`/auth/status` 在一次页面加载里只发一个请求（插件入口探针 / 账户区 hook / 登出按钮
 * 经同一个共享探针）。这里只钉「并发消费者合并成一个请求」。
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
const requests: string[] = [];

function StatusProbe(): ReactElement {
  const { state } = useAccountStatus();
  return createElement("pre", { "data-testid": "status" }, JSON.stringify(state));
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input: unknown) => {
    requests.push(String(input));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ authenticated: true, logoutOrder: 1000 }),
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  document.body.innerHTML = "";
});

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

describe("共享 /auth/status 探针（C9）", () => {
  it("coalesces concurrent consumers into one request", async () => {
    const { root, container } = await render(
      createElement("div", null, createElement(StatusProbe), createElement(StatusProbe)),
    );
    expect(requests.filter((url) => url === "/auth/status")).toHaveLength(1);
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
