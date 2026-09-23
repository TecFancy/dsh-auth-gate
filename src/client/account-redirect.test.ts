/**
 * 改密成功后的跳转常量与时序（P1.1 / D24）。
 *
 * 客户端半边刻意不 import 服务端 `shared`，所以 `notice=password-changed` 这个键在两侧各写
 * 一份字面量：这里钉住客户端这一侧（URL + 时序 + 幂等/去重），服务端由 `login-notice.test.ts`
 * 钉住，跨侧一致性由 `integration.password-change.test.ts` 的 source-pin 用例钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelScheduledRedirect,
  LOGIN_REDIRECT_DELAY_MS,
  LOGIN_REDIRECT_URL,
  redirectToLogin,
  redirectToLoginNow,
  scheduleRedirectToLogin,
} from "./account-redirect.js";

describe("account redirect constants", () => {
  it("points at the login page with the whitelisted notice key", () => {
    expect(LOGIN_REDIRECT_URL).toBe("/auth/login?next=%2F&notice=password-changed");
    const query = new URLSearchParams(LOGIN_REDIRECT_URL.split("?")[1]);
    expect(query.get("notice")).toBe("password-changed");
    expect(query.get("next")).toBe("/");
  });

  it("keeps the success copy readable for a beat before leaving", () => {
    expect(LOGIN_REDIRECT_DELAY_MS).toBe(2500);
  });

  it("hands the constant URL to the injected navigation", () => {
    const nav = vi.fn();
    redirectToLogin(nav);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(LOGIN_REDIRECT_URL);
  });
});

describe("account redirect scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelScheduledRedirect();
    vi.useRealTimers();
  });

  it("fires exactly at the delay, with the constant URL", () => {
    const nav = vi.fn();
    scheduleRedirectToLogin(nav);
    vi.advanceTimersByTime(LOGIN_REDIRECT_DELAY_MS - 1);
    expect(nav).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(LOGIN_REDIRECT_URL);
  });

  it("re-schedules instead of stacking (Strict Mode double mount fires once)", () => {
    const nav = vi.fn();
    scheduleRedirectToLogin(nav);
    vi.advanceTimersByTime(1000);
    scheduleRedirectToLogin(nav);
    vi.advanceTimersByTime(LOGIN_REDIRECT_DELAY_MS);
    expect(nav).toHaveBeenCalledTimes(1);
  });

  it("immediate redirect cancels the pending one (no second hop)", () => {
    const scheduled = vi.fn();
    const immediate = vi.fn();
    scheduleRedirectToLogin(scheduled);
    redirectToLoginNow(immediate);
    expect(immediate).toHaveBeenCalledWith(LOGIN_REDIRECT_URL);
    vi.advanceTimersByTime(LOGIN_REDIRECT_DELAY_MS * 4);
    expect(scheduled).not.toHaveBeenCalled();
  });

  it("is idempotent when the button is clicked repeatedly", () => {
    const nav = vi.fn();
    redirectToLoginNow(nav);
    redirectToLoginNow(nav);
    vi.advanceTimersByTime(LOGIN_REDIRECT_DELAY_MS * 4);
    expect(nav).toHaveBeenCalledTimes(2); // 同 URL 的两次 replace，不会多出定时器那一跳
    expect(nav).toHaveBeenNthCalledWith(1, LOGIN_REDIRECT_URL);
    expect(nav).toHaveBeenNthCalledWith(2, LOGIN_REDIRECT_URL);
  });
});
