import { describe, expect, it } from "vitest";
import { INVALID_CREDENTIALS, lockoutMessage } from "./login-failure-pages.js";

describe("login failure copy (D20)", () => {
  it("keeps one enumeration-safe constant for the 401 slot", () => {
    expect(INVALID_CREDENTIALS).toBe("Invalid username or password.");
    // 三态共用：不得出现账号存在性/禁用相关措辞
    expect(INVALID_CREDENTIALS).not.toMatch(/unknown|not found|disabled|locked/i);
  });

  it("scopes the lockout to the network and never blames an account", () => {
    const text = lockoutMessage(30);
    expect(text).toContain("Too many sign-in attempts from this network.");
    expect(text).toContain("Try again in 30 seconds.");
    expect(text).not.toMatch(/your account|locked out|remaining attempts/i);
  });

  it("uses the singular unit for one second", () => {
    expect(lockoutMessage(1)).toContain("Try again in 1 second.");
    expect(lockoutMessage(1)).not.toContain("1 seconds");
  });

  it("renders the retry-after integer without touching request text", () => {
    expect(lockoutMessage(900)).toContain("Try again in 900 seconds.");
  });
});
