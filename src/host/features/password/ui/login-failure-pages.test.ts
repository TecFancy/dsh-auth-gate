import { describe, expect, it } from "vitest";
import { INVALID_CREDENTIALS } from "./login-failure-pages.js";

describe("login failure copy (D20)", () => {
  it("keeps one enumeration-safe constant for the 401 slot", () => {
    expect(INVALID_CREDENTIALS).toBe("Invalid username or password.");
    // 三态共用：不得出现账号存在性/禁用相关措辞
    expect(INVALID_CREDENTIALS).not.toMatch(/unknown|not found|disabled|locked/i);
  });
});
