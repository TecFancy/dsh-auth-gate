/**
 * 改密成功后的跳转（P1.1 / D24；D24.1 起立即走）。
 *
 * URL 与 `notice=password-changed` 键来自跨半边契约 `src/protocol/`（D31，值由
 * `src/protocol/index.test.ts` 钉住）；这里钉住客户端这一侧的用法（URL + 白名单键 + 注入点 +
 * replace 语义）。
 */
import { describe, expect, it, vi } from "vitest";
import { LOGIN_REDIRECT_URL, redirectToLogin } from "./account-redirect.ts";

describe("account redirect", () => {
  it("points at the login page with the whitelisted notice key", () => {
    expect(LOGIN_REDIRECT_URL).toBe("/auth/login?next=%2F&notice=password-changed");
    const query = new URLSearchParams(LOGIN_REDIRECT_URL.split("?")[1]);
    expect(query.get("notice")).toBe("password-changed");
    expect(query.get("next")).toBe("/");
  });

  it("hands the constant URL to the injected navigation", () => {
    const nav = vi.fn();
    redirectToLogin(nav);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(LOGIN_REDIRECT_URL);
  });

  it("navigates with replace so the dead session shell never enters history", () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    try {
      redirectToLogin();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(LOGIN_REDIRECT_URL);
  });
});
