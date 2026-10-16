import { describe, expect, it } from "vitest";
import {
  AUTH_PATH_PREFIX,
  isAuthPath,
  LOGIN_PATH,
  loginPath,
  LOGOUT_PATH,
  LOGOUT_URL,
  PASSWORD_CHANGED_LOGIN_URL,
  PASSWORD_CHANGED_NOTICE,
  PASSWORD_PATH,
  STATUS_PATH,
  USERS_PASSWORD_PATH,
  USERS_PATH,
} from "./index.js";

/**
 * 契约钉子：这些值是对外接口（书签、反代规则、宿主跳转都认），改动必须是有意的，
 * 所以先在这里改期望值，再改 `index.ts`。
 */
describe("protocol: /auth contract", () => {
  it("pins every route path", () => {
    expect({
      AUTH_PATH_PREFIX,
      LOGIN_PATH,
      LOGOUT_PATH,
      STATUS_PATH,
      PASSWORD_PATH,
      USERS_PATH,
      USERS_PASSWORD_PATH,
    }).toEqual({
      AUTH_PATH_PREFIX: "/auth",
      LOGIN_PATH: "/auth/login",
      LOGOUT_PATH: "/auth/logout",
      STATUS_PATH: "/auth/status",
      PASSWORD_PATH: "/auth/password",
      USERS_PATH: "/auth/users",
      USERS_PASSWORD_PATH: "/auth/users/password",
    });
  });

  it("pins the composed URLs and the notice key", () => {
    expect(PASSWORD_CHANGED_NOTICE).toBe("password-changed");
    expect(PASSWORD_CHANGED_LOGIN_URL).toBe("/auth/login?next=%2F&notice=password-changed");
    expect(LOGOUT_URL).toBe("/auth/logout?next=/");
  });

  it("builds login URLs with an encoded next and an optional stage", () => {
    expect(loginPath("/a b?x=1")).toBe("/auth/login?next=%2Fa%20b%3Fx%3D1");
    expect(loginPath("/", "password")).toBe("/auth/login?next=%2F&stage=password");
  });

  it.each([
    ["/auth", true],
    ["/auth/", true],
    ["/auth/login", true],
    ["/auth/users/password", true],
    ["/authx", false],
    ["/", false],
    ["/api/auth", false],
  ])("isAuthPath(%s) is %s", (pathname, expected) => {
    expect(isAuthPath(pathname)).toBe(expected);
  });
});
