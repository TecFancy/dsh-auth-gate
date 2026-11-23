// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, formatCopy } from "../../../shared/i18n/index.ts";
import { SettingsAccountSection } from "./account-section.tsx";

// 管理块只标记渲染门：本文件只关心页脚的受众判定，不重复覆盖用户表的语义。
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

const REPO_URL = "https://github.com/TecFancy/dsh-auth-gate";

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): unknown {
  return { ok: status === 200, status, json: () => Promise.resolve(body) };
}

/** 路由式 fetch mock：`/auth/status` 回给定体，管理/passkey 面回空数据。 */
function stubStatus(status: Record<string, unknown>): void {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url === "/auth/status") return Promise.resolve(jsonResponse(200, status));
    if (url === "/auth/users") return Promise.resolve(jsonResponse(200, { users: [] }));
    if (url === "/auth/passkey") return Promise.resolve(jsonResponse(200, { passkeys: [] }));
    return Promise.resolve(jsonResponse(200, { conditionalUiEnabled: false }));
  });
}

interface Rendered {
  root: Root;
  container: HTMLDivElement;
}

async function render(t: typeof zh): Promise<Rendered> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsAccountSection, { t }));
    await flushMicrotasks();
  });
  return { root, container };
}

function cleanup({ root, container }: Rendered): void {
  act(() => root.unmount());
  container.remove();
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("SettingsAccountSection: footer audience", () => {
  /** 普通用户：identity 齐但 role 是 user。 */
  const USER_STATUS = {
    authenticated: true,
    name: "yunfei",
    role: "user",
    disabled: false,
    totpEnabled: false,
    sessionKind: "full",
    logoutOrder: 1000,
    mode: "password",
    version: "0.24.0",
  };

  /** 管理员：装插件的那个人的身份。 */
  const ADMIN_STATUS = { ...USER_STATUS, name: "admin", role: "admin" };

  it("shows the version to an ordinary user but not the star entry", async () => {
    stubStatus(USER_STATUS);
    const rendered = await render(zh);
    expect(rendered.container.querySelector("footer")).not.toBeNull();
    expect(rendered.container.textContent).toContain("dsh-auth-gate v0.24.0");
    expect(rendered.container.querySelector("a")).toBeNull();
    cleanup(rendered);
  });

  it("shows the star entry to an administrator", async () => {
    stubStatus(ADMIN_STATUS);
    const rendered = await render(zh);
    const link = rendered.container.querySelector("footer a");
    expect(link?.getAttribute("href")).toBe(REPO_URL);
    expect(link?.textContent).toBe("给个星星鼓励一下 ★");
    cleanup(rendered);
  });

  it("shows the star entry in token mode, where the only visitor is the operator", async () => {
    // token 模式没有身份字段（没有 role/name）：持共享令牌的人就是装插件的人。
    stubStatus({ authenticated: true, logoutOrder: 1000, mode: "token", version: "0.24.0" });
    const rendered = await render(en);
    expect(rendered.container.querySelector("footer a")?.getAttribute("href")).toBe(REPO_URL);
    expect(rendered.container.textContent).toContain("Give it a star ★");
    cleanup(rendered);
  });

  it("renders no footer at all for an old server that reports neither fact", async () => {
    // 旧服务端的响应体里根本没有这两个键：显式删掉，而不是构造一个"值为 undefined"的对象。
    const oldStatus: Record<string, unknown> = { ...USER_STATUS };
    delete oldStatus["mode"];
    delete oldStatus["version"];
    stubStatus(oldStatus);
    const rendered = await render(zh);
    // 旧服务端：缺 mode/version = 不知道 -> 页脚整块不出现（不反推模式、不显示空版本）。
    expect(rendered.container.querySelector("footer")).toBeNull();
    cleanup(rendered);
  });

  it("renders nothing for an unauthenticated visitor with a version", async () => {
    stubStatus({ authenticated: false, logoutOrder: 1000, mode: "token", version: "0.24.0" });
    const rendered = await render(zh);
    expect(rendered.container.textContent).toContain("请先登录");
    expect(rendered.container.querySelector("footer")).toBeNull();
    cleanup(rendered);
  });
});
