// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "../../../shared/i18n/index.ts";
import { ADMIN_DICT_ZH, ADMIN_KEYS } from "../lib/admin-copy.ts";
import { AdminResetForm } from "./admin-form.tsx";
import type { AdminUserRow } from "../../../shared/api/index.ts";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // jsdom 的 scoped `querySelector("#id")` 会命中 document 里更早的同 id 元素并放弃，
  // 所以每个用例后必须清空 DOM（否则上一个容器的字段会遮住当前容器的同名 id）。
  document.body.innerHTML = "";
});

/** 与 host locale 同形的 translate：admin 与 account 键合并在同一个 seat 上。 */
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

async function render(actorTotpEnabled = false) {
  // 同一用例内可能渲染多次：先清空，避免上一个容器的同名 id 遮住本次查询。
  document.body.innerHTML = "";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const onReset = vi.fn();
  await act(async () => {
    root.render(
      createElement(AdminResetForm, {
        t,
        users: USERS,
        actorName: "admin",
        actorTotpEnabled,
        onReset,
      }),
    );
    await flushMicrotasks();
  });
  return { root, container, onReset };
}

function input(container: HTMLElement, field: string): HTMLInputElement {
  return container.querySelector(`#dsh-auth-gate-admin-${field}`)!;
}

function select(container: HTMLElement): HTMLSelectElement {
  return container.querySelector("#dsh-auth-gate-admin-target")!;
}

/** React 受控组件：先用原生 setter 改值，再派发 input/change。 */
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  for (const type of ["input", "change"]) element.dispatchEvent(new Event(type, { bubbles: true }));
}

async function fill(
  container: HTMLElement,
  values: { target?: string; password?: string; confirm?: string; code?: string },
): Promise<void> {
  await act(async () => {
    if (values.target !== undefined) setValue(select(container), values.target);
    for (const field of ["password", "confirm", "code"] as const) {
      const next = values[field];
      if (next !== undefined) setValue(input(container, field), next);
    }
    await flushMicrotasks();
  });
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form");
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();
  });
}

/** 状态播报位。 */
function status(container: HTMLElement): HTMLElement {
  return container.querySelector("#dsh-auth-gate-admin-status")!;
}

/** 按可见文本找按钮（确认页有两个按钮，按文本区分最稳）。 */
function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  if (button === undefined) throw new Error(`missing button: ${text}`);
  return button;
}

describe("AdminResetForm：结构与可访问性（契约 §3.5-§3.7 / A5）", () => {
  it("目标下拉排除本人、空初始、带占位 option", async () => {
    const { container } = await render();
    expect([...select(container).options].map((option) => option.value)).toEqual([
      "",
      "alice",
      "bob",
    ]);
    expect(select(container).value).toBe("");
    expect(select(container).options[0]?.textContent).toBe(t(ADMIN_KEYS.targetPlaceholder));
    expect(container.textContent).toContain(t(ADMIN_KEYS.selfHint));
  });

  it("code 输入框仅当 actorTotpEnabled 时渲染（autocomplete 断言见 admin-fields.test.tsx）", async () => {
    const off = await render(false);
    expect(off.container.querySelector("#dsh-auth-gate-admin-code")).toBeNull();
    const on = await render(true);
    expect(on.container.querySelector("#dsh-auth-gate-admin-code")).not.toBeNull();
    expect(on.container.textContent).toContain(t(ADMIN_KEYS.codeHint));
    expect(input(on.container, "password").getAttribute("autocomplete")).toBe("new-password");
    expect(input(on.container, "confirm").getAttribute("autocomplete")).toBe("new-password");
    await fill(on.container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submit(on.container);
    expect(status(on.container).textContent).toContain(t(ADMIN_KEYS.codeRequired));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** A6 本地校验闭表：`[名称, 是否启用两步验证, 表单值, 期望文案键]`。 */
const PW = "NewPassw0rd!XY";
const INVALID_CASES: [
  string,
  boolean,
  { target?: string; password?: string; confirm?: string },
  string,
][] = [
  ["未选目标", false, { password: PW, confirm: PW }, ADMIN_KEYS.targetRequired],
  ["密码为空", false, { target: "alice" }, ADMIN_KEYS.passwordRequired],
  ["两次不一致（含 confirm 空）", false, { target: "alice", password: PW }, ADMIN_KEYS.mismatch],
  [
    "启用两步验证但 code 为空",
    true,
    { target: "alice", password: PW, confirm: PW },
    ADMIN_KEYS.codeRequired,
  ],
];

describe("AdminResetForm：本地校验（A6）与双锁（A11）", () => {
  for (const [name, totp, values, key] of INVALID_CASES) {
    it(`${name} → 提示且不发请求`, async () => {
      const { container } = await render(totp);
      await fill(container, values);
      await submit(container);
      expect(status(container).textContent).toContain(t(key));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("确认页双击只发一次请求（in-flight 硬锁）", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { container } = await render();
    await fill(container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submit(container);
    const confirmButton = buttonByText(container, t(ADMIN_KEYS.confirmSubmit, { name: "alice" }));
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("第一次提交只进确认页，不发请求", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, sessionsRevoked: true }));
    const { container } = await render();
    await fill(container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submit(container);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t(ADMIN_KEYS.confirmTitle, { name: "alice" }));
    expect(container.textContent).toContain(t(ADMIN_KEYS.confirmWarning, { name: "alice" }));
    expect(container.textContent).toContain(
      t(ADMIN_KEYS.resetContext, { name: "alice", actor: "admin" }),
    );
  });

  it("确认页「返回修改」保留全部值并回到编辑", async () => {
    const { container } = await render();
    await fill(container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submit(container);
    await act(async () => {
      buttonByText(container, t(ADMIN_KEYS.back)).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushMicrotasks();
    });
    expect(select(container).value).toBe("alice");
    expect(input(container, "password").value).toBe("NewPassw0rd!XY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
