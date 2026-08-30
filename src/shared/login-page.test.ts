import { describe, expect, it } from "vitest";
import { loginPageHtml, passwordLoginPageHtml } from "./login-page.js";
import { langOf } from "./http-lang.js";

describe("login page HTML (token mode)", () => {
  it("renders the zh brand, slogan and subtitle for zh", () => {
    const html = loginPageHtml("/app", undefined, "zh");
    expect(html).toContain("探索未至之境");
    expect(html).toContain("请输入访问令牌继续");
    expect(html).toContain('lang="zh"');
  });

  it("renders the en brand, slogan and subtitle by default", () => {
    const html = loginPageHtml("/app");
    expect(html).toContain("Into the Unknown");
    expect(html).toContain("Enter your access token to continue");
    expect(html).toContain('lang="en"');
  });

  it("escapes `next` to prevent open-redirect/HTML injection", () => {
    const html = loginPageHtml('"><script>alert(1)</script>', undefined, "zh");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("escapes the error message", () => {
    const html = loginPageHtml("/app", "<b>bad</b>&oops;", "zh");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;&amp;oops;");
    expect(html).not.toContain("<b>bad</b>");
  });

  it("renders the single token field with autofocus", () => {
    const html = loginPageHtml("/app", undefined, "zh");
    expect(html).toMatch(/id="token"[^>]*autofocus/);
    expect(html).toContain('aria-label="访问令牌"');
  });
});

describe("login page HTML (password mode)", () => {
  it("renders the zh brand and subtitle", () => {
    const html = passwordLoginPageHtml("/app", undefined, "zh");
    expect(html).toContain("欢迎回来，请登录以继续");
    expect(html).toContain("探索未至之境");
  });

  it("renders username + password fields with placeholders", () => {
    const html = passwordLoginPageHtml("/app", undefined, "zh");
    expect(html).toContain('placeholder="请输入用户名"');
    expect(html).toContain('placeholder="请输入密码"');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
  });

  it("defaults to English text when lang is undefined", () => {
    const html = passwordLoginPageHtml("/app");
    expect(html).toContain("Sign in");
    expect(html).toContain("Welcome back - sign in to continue");
    expect(html).toContain("Into the Unknown");
  });

  it("includes the WCAG-friendly secondary text color (#6e6e73, >= 4.5:1 on white)", () => {
    const html = passwordLoginPageHtml("/app", undefined, "zh");
    expect(html).toContain("color: #6e6e73");
    expect(html).not.toContain("color: #a1a1a6");
    expect(html).not.toContain(".subtitle { font-size: 14px; color: #86868b");
  });

  it("keeps the secured-by footer and brand harness badge", () => {
    const html = passwordLoginPageHtml("/app", undefined, "zh");
    expect(html).toContain("Secured by dsh-auth-gate");
    expect(html).toContain('data-cursor="blend"');
  });

  it("escapes `next` in password mode too", () => {
    const html = passwordLoginPageHtml("/app?x=<y>", undefined, "zh");
    expect(html).toContain("/app?x=&lt;y&gt;");
  });
});

describe("langOf", () => {
  it("resolves zh from a zh Accept-Language header", () => {
    expect(langOf({ headers: { "accept-language": "zh-CN,zh;q=0.9" } })).toBe("zh");
    expect(langOf({ headers: { "accept-language": "en-US,zh;q=0.8" } })).toBe("zh");
  });

  it("handles the array form of IncomingHttpHeaders", () => {
    expect(langOf({ headers: { "accept-language": ["zh-CN", "zh;q=0.9"] } })).toBe("zh");
    expect(langOf({ headers: { "accept-language": ["en-US", "en;q=0.9"] } })).toBe("en");
  });

  it("falls back to en for non-zh languages", () => {
    expect(langOf({ headers: { "accept-language": "en-US,en;q=0.9" } })).toBe("en");
    expect(langOf({ headers: {} })).toBe("en");
    expect(langOf({})).toBe("en");
  });
});
