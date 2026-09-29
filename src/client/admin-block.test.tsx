// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "./account-copy.ts";
import { ADMIN_DICT_ZH, ADMIN_KEYS } from "./admin-copy.ts";
import { AdminUsersBlock } from "./admin-block.tsx";
import type { AdminUserRow } from "./admin-types.ts";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** 与 host locale 同形的 translate（支持 {seconds} 插值）：admin 与 account 键合并在一个 seat。 */
const t = (key: string, params?: Record<string, unknown>): string =>
  formatCopy({ ...ACCOUNT_DICT_ZH, ...ADMIN_DICT_ZH }[key] ?? key, params);

const USERS: AdminUserRow[] = [
  { name: "admin", role: "admin", disabled: false, totpEnabled: true, mustChangePassword: false },
  { name: "alice", role: "user", disabled: true, totpEnabled: false, mustChangePassword: false },
  { name: "bob", role: "user", disabled: false, totpEnabled: false, mustChangePassword: true },
];

function jsonResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

async function render(props: { actorTotpEnabled?: boolean } = {}): Promise<{
  root: Root;
  container: HTMLDivElement;
}> {
  // 同一用例内可能渲染多次：先清空，避免上一个容器的同名 id 遮住本次查询。
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(AdminUsersBlock, {
        t,
        actorName: "admin",
        actorTotpEnabled: props.actorTotpEnabled ?? false,
      }),
    );
    await flushMicrotasks();
  });
  return { root, container };
}

/** A11：只断言 pathname 集合/出现次数下界，不断言精确调用次数（StrictMode 会双调用）。 */
function pathnames(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/** 第一列的第一个 span 是用户名（「本人」徽标是同行第二个 span）。 */
function rowNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr")].map(
    (row) => row.querySelector("td span")?.textContent ?? "",
  );
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AdminUsersBlock：列表四态（契约 §3 / A2）", () => {
  it("loading：首次响应前显示提示", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { container } = await render();
    expect(container.textContent).toContain(t(ADMIN_KEYS.loading));
    expect(pathnames()).toContain("/auth/users");
  });

  it("ok：按服务端顺序渲染行 + 角色/状态/TOTP 徽标 + 本人标记", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { users: USERS }));
    const { container } = await render();
    expect(pathnames()).toContain("/auth/users");
    expect(rowNames(container)).toEqual(["admin", "alice", "bob"]); // 保持原序，不重排
    const text = container.textContent ?? "";
    for (const key of [
      ADMIN_KEYS.roleAdmin,
      ADMIN_KEYS.roleUser,
      ADMIN_KEYS.you,
      ADMIN_KEYS.stateDisabled,
      ADMIN_KEYS.stateMustChange,
      ADMIN_KEYS.stateOk,
      ADMIN_KEYS.totpOn,
      ADMIN_KEYS.totpOff,
    ]) {
      expect(text).toContain(t(key));
    }
    expect(container.querySelector("select")).not.toBeNull();
  });

  it("只有本人：显示 empty 且不渲染表单", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { users: [USERS[0]] }));
    const { container } = await render();
    expect(container.textContent).toContain(t(ADMIN_KEYS.empty));
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("403 → denied 静默降级：整块渲染 null", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    const { container } = await render();
    expect(container.textContent).toBe("");
    expect(container.querySelector("form")).toBeNull();
  });

  it("401 → unauthorized 提示，不渲染列表与表单（A2）", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    const { container } = await render();
    expect(container.textContent).toContain(t(ADMIN_KEYS.unauthorized));
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("503 / 网络异常 → unavailable 且不渲染表单", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, {}));
    const broken = await render();
    expect(broken.container.textContent).toContain(t(ADMIN_KEYS.unavailable));
    expect(broken.container.querySelector("form")).toBeNull();

    fetchMock.mockRejectedValue(new Error("network down"));
    const thrown = await render();
    expect(thrown.container.textContent).toContain(t(ADMIN_KEYS.unavailable));
  });
});

describe("AdminUsersBlock：行内容与刷新（A7 / A9 / A11）", () => {
  it("恶意 name 原样按文本渲染，不产生元素", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        users: [{ ...USERS[0], name: evil }],
      }),
    );
    const { container } = await render();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(evil);
  });

  it("成功后重拉列表刷新徽标（A7）", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/auth/users/password"
          ? jsonResponse(200, { ok: true, sessionsRevoked: true })
          : jsonResponse(200, { users: USERS }),
      ),
    );
    const { container } = await render();
    await act(async () => {
      setValue(container.querySelector("#dsh-auth-gate-admin-target")!, "alice");
      setValue(container.querySelector("#dsh-auth-gate-admin-password")!, "NewPassw0rd!XY");
      setValue(container.querySelector("#dsh-auth-gate-admin-confirm")!, "NewPassw0rd!XY");
      await flushMicrotasks();
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(pathnames()).toContain("/auth/users/password");
    expect(pathnames().filter((path) => path === "/auth/users").length).toBeGreaterThanOrEqual(2);
  });

  it("actorTotpEnabled 透传给表单：开启时出现动态码输入框", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { users: USERS }));
    const { container } = await render({ actorTotpEnabled: true });
    expect(container.querySelector("#dsh-auth-gate-admin-code")).not.toBeNull();
  });

  it("卸载即 abort 列表请求（§3.12）", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { root } = await render();
    const signal = (fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)?.signal;
    expect(signal?.aborted).toBe(false);
    await act(async () => {
      root.unmount();
      await flushMicrotasks();
    });
    expect(signal?.aborted).toBe(true);
  });
});
