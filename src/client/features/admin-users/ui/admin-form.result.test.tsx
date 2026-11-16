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

/** 按可见文本找按钮（确认页有两个按钮，按文本区分最稳）。 */
function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  if (button === undefined) throw new Error(`missing button: ${text}`);
  return button;
}

/**
 * 走完两阶段提交：编辑页 submit → 确认页点「确认重置」。
 *
 * 重设计（2026-11-16）后第一次 submit 只进确认页、不发请求；真正发请求的是确认页
 * 那个显式按钮。所有「期望发出请求」的用例都要经过这里。
 */
async function submitAndConfirm(container: HTMLElement, target: string): Promise<void> {
  await submit(container);
  await act(async () => {
    buttonByText(container, t(ADMIN_KEYS.confirmSubmit, { name: target })).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushMicrotasks();
  });
}

function status(container: HTMLElement): HTMLElement {
  return container.querySelector("#dsh-auth-gate-admin-status")!;
}

/** 合规口令（14 位四类字符）。 */
const PW = "NewPassw0rd!XY";

describe("AdminResetForm：提交结果渲染（§3.8 / A8）", () => {
  it("成功后四字段清空 + 成功文案；sessionsRevoked:false 改走 alert（A8）", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, sessionsRevoked: true }));
    const { container, onReset } = await render(true);
    await fill(container, { target: "bob", password: PW, confirm: PW, code: "123456" });
    await submitAndConfirm(container, "bob");
    expect(select(container).value).toBe("");
    expect(["password", "confirm", "code"].map((f) => input(container, f).value)).toEqual([
      "",
      "",
      "",
    ]);
    expect(status(container).textContent).toContain(t(ADMIN_KEYS.successRevoked));
    expect(status(container).getAttribute("role")).toBe("status");
    expect(onReset).toHaveBeenCalledTimes(1);
    const body = String((fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined)?.body);
    expect(body).not.toContain("confirm");

    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, sessionsRevoked: false }));
    await fill(container, { target: "alice", password: PW, confirm: PW, code: "123456" });
    await submitAndConfirm(container, "alice");
    const alert = container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(alert?.textContent).toContain(t(ADMIN_KEYS.successKept));
    expect(alert?.style.color).toContain("error");
    expect(t(ADMIN_KEYS.successKept)).not.toBe(t(ADMIN_KEYS.successRevoked));
  });

  it("400 policy → 规则逐条翻译列出", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "policy", rules: ["minLength", "digit"] }),
    );
    const { container } = await render();
    await fill(container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submitAndConfirm(container, "alice");
    const items = [...container.querySelectorAll("#dsh-auth-gate-admin-status li")].map(
      (item) => item.textContent,
    );
    expect(items).toEqual([t("account.rule.minLength"), t("account.rule.digit")]);
    expect(status(container).textContent).toContain(t(ADMIN_KEYS.policyIntro));
  });

  it("429 → 秒数插值；403 → forbidden", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: "locked", retryAfter: 42 }));
    const locked = await render();
    await fill(locked.container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submitAndConfirm(locked.container, "alice");
    expect(status(locked.container).textContent).toContain(t(ADMIN_KEYS.locked, { seconds: 42 }));

    fetchMock.mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    const denied = await render();
    await fill(denied.container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submitAndConfirm(denied.container, "alice");
    expect(status(denied.container).textContent).toContain(t(ADMIN_KEYS.forbidden));
  });
});

describe("AdminResetForm：卸载与异常（§3.12 / A11）", () => {
  it("卸载 abort 后不再 setState、不抛错", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolveFetch: ((value: Response) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { container, root } = await render();
    await fill(container, {
      target: "alice",
      password: "NewPassw0rd!XY",
      confirm: "NewPassw0rd!XY",
    });
    await submitAndConfirm(container, "alice");
    await act(async () => {
      root.unmount();
      resolveFetch?.(jsonResponse(200, { ok: true, sessionsRevoked: true }));
      await flushMicrotasks();
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
