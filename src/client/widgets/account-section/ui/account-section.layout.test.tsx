// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "../../../shared/i18n/index.ts";
import { SettingsAccountSection } from "./account-section.tsx";

// 跳转是副作用：这里替换成 spy，测试只断言"什么时候请求跳、跳几次"；真实 URL 与 replace 语义由
// account-redirect.test.ts 钉住，跨侧常量一致性由 integration.p11-pins.test.ts 的 source-pin 钉住。
const redirectApi = vi.hoisted(() => ({
  redirectToLogin: vi.fn(),
  redirectToSignIn: vi.fn(),
}));
vi.mock("../../../features/change-password/lib/account-redirect.ts", () => ({
  LOGIN_REDIRECT_URL: "/auth/login?next=%2F&notice=password-changed",
  SIGN_IN_URL: "/auth/login?next=%2F",
  ...redirectApi,
}));

// 管理块只标记渲染门（真组件的列表/表单语义由 client-view 的测试覆盖）：本文件只断言
// 「旧服务端缺身份字段时不渲染管理块、也不发管理请求」。
vi.mock("./admin-block.tsx", async () => {
  const { createElement: h } = await import("react");
  return { AdminUsersBlock: () => h("div", { "data-testid": "admin-block" }) };
});

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
/** 卸载并移除容器（act 包裹卸载，避免测试输出 act 警告）。 */
function cleanup(root: Root, container: HTMLElement): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

/** /auth/status 响应（authenticated + host 的 logoutOrder）。 */
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

describe("SettingsAccountSection: 重设计的信息架构", () => {
  /** 完整身份投影：admin + full 会话 + 已开 TOTP + passkey 可用。 */
  const ADMIN_STATUS = {
    authenticated: true,
    name: "admin",
    role: "admin",
    disabled: false,
    totpEnabled: true,
    sessionKind: "full",
    logoutOrder: 1000,
    passkeyEnabled: true,
  };

  it("shows the account context row when the server sends identity fields", async () => {
    routeFetch((url) => {
      if (url === "/auth/status") return jsonResponse(200, ADMIN_STATUS);
      if (url === "/auth/users") return jsonResponse(200, { users: [] });
      if (url === "/auth/passkey") return jsonResponse(200, { passkeys: [] });
      return jsonResponse(200, { conditionalUiEnabled: false });
    });
    const { root, container } = await render({ t: zh });
    expect(container.textContent).toContain("本地账号");
    expect(container.textContent).toContain("admin");
    expect(container.textContent).toContain("管理员");
    expect(container.textContent).toContain("两步验证已开启");
    cleanup(root, container);
  });

  it("wraps the admin blocks in one instance-management area for admins", async () => {
    routeFetch((url) => {
      if (url === "/auth/status") return jsonResponse(200, ADMIN_STATUS);
      if (url === "/auth/users") return jsonResponse(200, { users: [] });
      if (url === "/auth/passkey") return jsonResponse(200, { passkeys: [] });
      return jsonResponse(200, { conditionalUiEnabled: false });
    });
    const { root, container } = await render({ t: zh });
    // 重设计：管理员不是换一套页面，而是在同一页后面追加一个「实例管理」区。
    expect(container.textContent).toContain("实例管理");
    expect(container.textContent).toContain("管理其他用户和本实例的登录方式");
    cleanup(root, container);
  });

  it("does not show the instance-management area to a plain user", async () => {
    routeFetch((url) => {
      if (url === "/auth/status") {
        return jsonResponse(200, { ...ADMIN_STATUS, role: "user", name: "alice" });
      }
      if (url === "/auth/passkey") return jsonResponse(200, { passkeys: [] });
      return jsonResponse(200, {});
    });
    const { root, container } = await render({ t: zh });
    expect(container.textContent).not.toContain("实例管理");
    cleanup(root, container);
  });

  it("does not request the passkey settings endpoint when passkey is off", async () => {
    const paths: string[] = [];
    routeFetch((url) => {
      paths.push(url);
      if (url === "/auth/status") {
        return jsonResponse(200, { ...ADMIN_STATUS, passkeyEnabled: false });
      }
      if (url === "/auth/users") return jsonResponse(200, { users: [] });
      return jsonResponse(200, {});
    });
    const { root, container } = await render({ t: zh });
    // 关闭 passkey 时端点根本不注册：多发一个必然 404 的请求违反「关闭时零请求」。
    expect(paths).not.toContain("/auth/passkey/settings");
    expect(container.textContent).not.toContain("登录页通行密钥自动填充");
    cleanup(root, container);
  });
});
