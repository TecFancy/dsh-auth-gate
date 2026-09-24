/**
 * gate 侧 Location 消毒（grok 实现期复审 G3）：`isSafeLocation` 与登录 `next`
 * 共用同一条判定，控制符必须在**所有** 302 出口被拒（deny 分支回退 LOGIN_PATH）。
 */
import { describe, expect, it } from "vitest";
import { isSafeLocation } from "./index.js";

describe("isSafeLocation: control characters", () => {
  it.each([
    ["tab split", "/\t/evil.com"],
    ["carriage return", "/x\r\nlocation: //evil.com"],
    ["null", "/x\u0000"],
    ["delete", "\u007f/evil.com"],
  ])("rejects %s", (_label, value) => {
    expect(isSafeLocation(value)).toBe(false);
  });

  it.each([
    ["root", "/"],
    ["path", "/plugins/dsh-auth/password"],
  ])("accepts %s", (_label, value) => {
    expect(isSafeLocation(value)).toBe(true);
  });

  it("still rejects the classic shapes", () => {
    expect(isSafeLocation("//evil.com")).toBe(false);
    expect(isSafeLocation("/\\evil.com")).toBe(false);
    expect(isSafeLocation("https://evil.com")).toBe(false);
  });
});
