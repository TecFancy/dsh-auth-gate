/**
 * 登录卡 notice 白名单（P1.1 / D24）。
 *
 * 这层的唯一职责：把 query 里的值**精确**映射成代码内常量，别的一律 undefined。
 * 精确匹配天然覆盖"超长 / 前后空白 / 大小写 / 编码变体"，所以实现里没有 length、trim、
 * toLowerCase 之类的分支（写了反而给人"可以放宽"的错觉）。
 */
import { describe, expect, it } from "vitest";
import {
  PASSWORD_CHANGED_NOTICE,
  PASSWORD_CHANGED_TEXT,
  resolveLoginNotice,
} from "./login-notice.js";

describe("resolveLoginNotice", () => {
  it("maps the exact key to the compiled-in copy", () => {
    expect(PASSWORD_CHANGED_NOTICE).toBe("password-changed");
    expect(resolveLoginNotice("password-changed")).toBe(PASSWORD_CHANGED_TEXT);
    expect(PASSWORD_CHANGED_TEXT).toBe(
      "Your password was changed. Sign in with your new password.",
    );
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["trailing space", "password-changed "],
    ["leading space", " password-changed"],
    ["case variant", "Password-changed"],
    ["prefix", "password-changed-extra"],
    ["null byte suffix", "password-changed\u0000"],
    ["percent encoded", "password-changed%00"],
    ["html payload", "<script>alert(1)</script>"],
    ["oversized", "x".repeat(4096)],
  ])("ignores %s", (_label, value) => {
    expect(resolveLoginNotice(value)).toBeUndefined();
  });
});
