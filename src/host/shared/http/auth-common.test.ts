/**
 * `validateNext` / `isSafeRelativeTarget` 的单元矩阵（grok 实现期复审 G3）。
 *
 * 回归的是两个真实缺陷：TAB 会被浏览器在 URL 解析前剥掉，`"/\t/evil.com"` 于是
 * 变成协议相对的 `//evil.com`（开放重定向）；CR/LF/NUL 会让 Node `writeHead` 抛
 * `ERR_INVALID_CHAR`，宿主 webserver 兜成 400（登录成功却回不出 302）。控制符必须
 * 在源头一律回落 `/`。
 */
import { describe, expect, it } from "vitest";
import { isSafeRelativeTarget, validateNext } from "./auth-common.js";

describe("isSafeRelativeTarget: location shape", () => {
  it.each([
    ["root", "/", true],
    ["path", "/ok/path", true],
    ["query", "/x?a=1&b=2", true],
    ["scheme relative", "//evil.com", false],
    ["absolute", "https://evil.com", false],
    ["backslash", "/\\evil.com", false],
    ["empty", "", false],
    ["no leading slash", "ok", false],
  ])("%s", (_label, value, expected) => {
    expect(isSafeRelativeTarget(value)).toBe(expected);
  });
});

describe("isSafeRelativeTarget: control characters", () => {
  it.each([
    ["tab", "/\t/evil.com"],
    ["carriage return", "/x\r\nSet-Cookie: y=1"],
    ["line feed", "/x\ny"],
    ["null", "/x\u0000y"],
    ["delete", "/x\u007fy"],
    ["vertical tab", "/x\u000by"],
    ["tab only", "\t"],
    ["C1 next line (NEL)", "/x\u0085y"],
    ["C1 range end", "/x\u009fy"],
  ])("rejects %s", (_label, value) => {
    expect(isSafeRelativeTarget(value)).toBe(false);
  });

  it("still accepts non-ASCII printable in-site paths", () => {
    // 中文工作区路径是合法站内目标：只拒控制符，不拒可打印非 ASCII。
    expect(isSafeRelativeTarget("/工作区/settings")).toBe(true);
    expect(validateNext("/工作区/settings")).toBe("/工作区/settings");
  });
});

describe("validateNext: fallbacks", () => {
  it.each([
    ["tab-split scheme relative", "/\t/evil.com"],
    ["encoded-looking tab is literal, then CRLF", "/x%09y\r\n"],
    ["auth root", "/auth"],
    ["auth subtree", "/auth/password"],
    ["scheme relative", "//evil.com"],
    ["backslash", "/\\evil.com"],
    ["absolute", "https://evil.com"],
  ])("falls back to / for %s", (_label, value) => {
    expect(validateNext(value)).toBe("/");
  });

  it("keeps an ordinary in-site path", () => {
    expect(validateNext("/api/events?a=1")).toBe("/api/events?a=1");
    expect(validateNext("/")).toBe("/");
  });
});
