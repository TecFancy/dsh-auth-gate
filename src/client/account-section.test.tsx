// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, formatCopy } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";

// 跳转是副作用：这里替换成 spy，测试只断言"什么时候请求跳、跳几次"；真实 URL 与 replace 语义由
// account-redirect.test.ts 钉住，跨侧常量一致性由 integration.p11-pins.test.ts 的 source-pin 钉住。
const redirectApi = vi.hoisted(() => ({
  redirectToLogin: vi.fn(),
}));
vi.mock("./account-redirect.ts", () => ({
  LOGIN_REDIRECT_URL: "/auth/login?next=%2F&notice=password-changed",
  ...redirectApi,
}));

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 让 fetch mock 的整条微任务链在 act 内跑完。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** 用真实词典造一个与 host locale 同形的 translate（支持 {seconds} 插值）。 */
function makeT(dict: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string =>
    formatCopy(dict[key] ?? key, params);
}

const zh = makeT(ACCOUNT_DICT_ZH);
const en = makeT(ACCOUNT_DICT_EN);

interface SectionProps {
  t?: typeof zh;
  /** 宿主 owner props（close 等）可透传：组件已不再使用它们，留作回归断言。 */
  [key: string]: unknown;
}

/** 渲染组件到独立容器（jsdom），返回 root 供卸载。 */
async function render(props: SectionProps): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsAccountSection, props));
    await flushMicrotasks();
  });
  return { root, container };
}

/** 等待一次提交的微任务链在 act 内结算。 */
async function settle(): Promise<void> {
  await act(async () => {
    await flushMicrotasks();
  });
}

/** 卸载并移除容器（act 包裹卸载，避免测试输出 act 警告）。 */
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

/** React 受控输入的写值方式：走原型 setter 再派发 input 事件。 */
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

/** 填一组合法输入（当前口令含空格：顺带验证 URLSearchParams 的 + 编码）。 */
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

/** /auth/status 响应（authenticated + host 的 logoutOrder）。 */
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

/** 路由式 fetch mock：按 url 返回 handler 的结果。 */
function routeFetch(handler: (url: string, init: RequestInit) => unknown): void {
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  for (const fn of Object.values(redirectApi)) fn.mockReset();
});

describe("SettingsAccountSection gate", () => {
  it("renders the account form with the four fields and a11y wiring when authenticated", async () => {
    routeFetch(() => statusOk(true));
    const { root, container } = await render({ t: zh });
    expect(container.querySelector("h2")?.textContent).toBe("修改密码");
    // P1.1：自设计图标画在我们自己的内容区（宿主 nav 没有 icon 挂载点，见 D24）
    const mark = container.querySelector("h2 svg");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(container.textContent).toContain("与 DeepSeek 云账户无关");
    expect(container.querySelectorAll("form input")).toHaveLength(4);
    expect(inputByName(container, "current").getAttribute("autocomplete")).toBe("current-password");
    expect(inputByName(container, "password").getAttribute("autocomplete")).toBe("new-password");
    expect(inputByName(container, "confirm").getAttribute("autocomplete")).toBe("new-password");
    expect(inputByName(container, "code").getAttribute("autocomplete")).toBe("one-time-code");
    expect(inputByName(container, "current").getAttribute("aria-describedby")).toBeNull();
    expect(inputByName(container, "code").getAttribute("aria-describedby")).toBe(
      "dsh-auth-gate-account-code-hint",
    );
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector("section")!.style.minHeight).toBe("0px");
    cleanup(root, container);
  });

  it("hides the form and shows the sign-in prompt when unauthenticated", async () => {
    routeFetch(() => statusOk(false));
    const { root, container } = await render({ t: zh });
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("请先登录");
    cleanup(root, container);
  });

  it("treats a failed session probe as unauthenticated", async () => {
    routeFetch(() => Promise.reject(new Error("network")));
    const { root, container } = await render({ t: zh });
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("请先登录");
    cleanup(root, container);
  });

  it("handles the loading window itself before the session probe resolves", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { root, container } = await render({ t: zh });
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在确认登录状态");
    cleanup(root, container);
  });

  it("falls back to the en dictionary when the locale seat is not injected", async () => {
    routeFetch(() => statusOk(true));
    const { root, container } = await render({});
    expect(container.querySelector("h2")?.textContent).toBe("Change password");
    cleanup(root, container);
  });

  it("follows the injected locale when the host switches language", async () => {
    routeFetch(() => statusOk(true));
    const { root, container } = await render({ t: zh });
    expect(container.querySelector("button[type=submit]")?.textContent).toBe("修改密码");
    await act(async () => {
      root.render(createElement(SettingsAccountSection, { t: en }));
      await flushMicrotasks();
    });
    expect(container.querySelector("button[type=submit]")?.textContent).toBe("Change password");
    expect(container.textContent).toContain("Current password");
    expect(container.textContent).toContain("Sign in again with your new password");
    expect(container.textContent).toContain("not your DeepSeek account");
    cleanup(root, container);
  });
});

describe("SettingsAccountSection submit", () => {
  it("POSTs urlencoded credentials, asserts the body, then hands the device its way out", async () => {
    const posts: [string, RequestInit][] = [];
    routeFetch((url, init) => {
      posts.push([url, init]);
      return url === "/auth/status" ? statusOk(true) : jsonResponse(200, { ok: true });
    });
    const { root, container } = await render({ t: zh });
    fillValid(container);
    submitForm(container);
    await settle();
    const post = posts.filter(([url]) => url === "/auth/password");
    expect(post).toHaveLength(1);
    const [, init] = post[0]!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    const body = init.body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.toString()).toBe("current=old+pass&password=NewPassw0rd&code=123456");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("密码已改，请重新登录");
    expect(container.textContent).toContain("当前设备也已登出");
    expect(container.querySelector("button")?.textContent).toBe("重新登录");
    // D24.1：成功响应一到就请求跳转（URL 与 replace 语义见 account-redirect.test.ts）
    expect(redirectApi.redirectToLogin).toHaveBeenCalledTimes(1);
    cleanup(root, container);
  });
});

describe("SettingsAccountSection host props", () => {
  it("ignores the host close prop after success (去向由会话状态决定，不是关弹窗)", async () => {
    const close = vi.fn();
    routeFetch((url) =>
      url === "/auth/status" ? statusOk(true) : jsonResponse(200, { ok: true }),
    );
    const { root, container } = await render({ t: zh, close });
    fillValid(container);
    submitForm(container);
    await settle();
    const relogin = container.querySelector("button");
    expect(relogin?.textContent).toBe("重新登录");
    act(() => {
      relogin?.click();
    });
    expect(close).not.toHaveBeenCalled();
    expect(redirectApi.redirectToLogin).toHaveBeenCalledTimes(2); // 成功时一次 + 手动点一次
    cleanup(root, container);
  });
});
