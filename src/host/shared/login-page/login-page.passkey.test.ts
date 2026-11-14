/**
 * 登录页 passkey 入口（M6 §5.7）：默认关闭时页面逐字不变；启用时按钮 / 隐藏表单 / 内联脚本
 * 都在，且无 JS 时按钮仍 `hidden`。脚本用 `node:vm` 只编译不执行（无 DOM 依赖）。
 *
 * 这一层钉住的是「页面能安全回退到口令」：任何 passkey 相关增强都不许把口令表单弄坏。
 */
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { CARD_STYLE } from "./login-page-assets.js";
import { loginPageHtml, passwordLoginPageHtml, totpChallengePageHtml } from "./login-page.js";
import { PASSKEY_ERROR_TEXT, PASSKEY_STYLE, passkeyLoginScript } from "./passkey-login.js";

const ENABLED = { passkey: { enabled: true, conditionalUi: false } } as const;
const CONDITIONAL = { passkey: { enabled: true, conditionalUi: true } } as const;
const FAILURE = "Invalid username or password.";

/** 取整页所有内联 `<script>` 的正文（顺序即页面顺序）。 */
function scriptBodies(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
}

describe("passkey entry: default off", () => {
  it("renders no passkey markup or script when the option is absent", () => {
    const html = passwordLoginPageHtml("/");
    expect(html).not.toContain("passkey");
    expect(html).toContain('action="/auth/login"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('autocomplete="username"');
  });

  it("treats enabled:false exactly like an absent option", () => {
    expect(
      passwordLoginPageHtml("/", FAILURE, { passkey: { enabled: false, conditionalUi: true } }),
    ).toBe(passwordLoginPageHtml("/", FAILURE));
  });

  it("ignores the passkey option on the token and TOTP cards", () => {
    expect(loginPageHtml("/", undefined, ENABLED)).not.toContain("passkey");
    expect(totpChallengePageHtml("/", undefined, ENABLED)).not.toContain("passkey");
  });
});

describe("passkey entry: enabled", () => {
  it("renders the hidden button, fixed error slot and hidden form after the password form", () => {
    const html = passwordLoginPageHtml("/", undefined, ENABLED);
    expect(html).toContain(
      '<button type="button" class="passkey" id="passkey-btn" hidden>Sign in with a passkey</button>',
    );
    expect(html).toContain(
      `<p class="error" id="passkey-error" role="alert" hidden>${PASSKEY_ERROR_TEXT}</p>`,
    );
    expect(html).toContain(
      '<form id="passkey-form" method="post" action="/auth/passkey/login" hidden>',
    );
    // 口令表单先渲染：passkey 片段（按钮/表单）都在口令表单闭合之后。
    expect(html.indexOf('id="passkey-btn"')).toBeGreaterThan(html.indexOf("</form>"));
  });

  it("carries exactly the PasskeyAssertionRequest field names", () => {
    const html = passwordLoginPageHtml("/", undefined, ENABLED);
    for (const name of [
      "id",
      "client_data_json",
      "authenticator_data",
      "signature",
      "user_handle",
      "next",
    ]) {
      expect(html).toContain(`<input type="hidden" name="${name}"`);
    }
  });

  it("keeps the passkey entry invisible without JS (hidden attributes stay server-rendered)", () => {
    const html = passwordLoginPageHtml("/", undefined, ENABLED);
    expect(html).toMatch(/id="passkey-btn" hidden>/);
    expect(html).toMatch(/id="passkey-form" method="post" action="\/auth\/passkey\/login" hidden>/);
    // 无 JS 时密码登录完全可用：表单与按钮照常提交
    expect(html).toMatch(/<form method="post" action="\/auth\/login">/);
    expect(html).toContain("Signing in...");
  });

  it("escapes next in the hidden passkey form", () => {
    const html = passwordLoginPageHtml("/a?b=1&c=<x>", undefined, ENABLED);
    expect(html).toMatch(/name="next" value="\/a\?b=1&amp;c=&lt;x&gt;"/);
    expect(html).not.toContain("<x>");
  });

  it("never reflects request text into the passkey error slot", () => {
    const malicious = '<img src=x onerror="alert(1)">';
    const html = passwordLoginPageHtml("/", malicious, ENABLED);
    const start = html.indexOf('<p class="error" id="passkey-error"');
    const slot = html.slice(start, html.indexOf("</p>", start) + 4);
    // 固定文案：整段与常量逐字相等，不夹带任何请求文本
    expect(slot).toBe(
      `<p class="error" id="passkey-error" role="alert" hidden>${PASSKEY_ERROR_TEXT}</p>`,
    );
    // 口令错误槽仍按旧行为转义渲染
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("inlines everything: the scripts reference no external URL", () => {
    const scripts = scriptBodies(passwordLoginPageHtml("/", undefined, ENABLED)).join("");
    expect(scripts).not.toContain("http");
    expect(scripts).toContain("navigator.credentials.get");
  });
});

describe("passkey entry: conditional UI", () => {
  it("adds the conditional branch only when conditionalUi is on", () => {
    const plain = scriptBodies(passwordLoginPageHtml("/", undefined, ENABLED)).join("");
    const conditional = scriptBodies(passwordLoginPageHtml("/", undefined, CONDITIONAL)).join("");
    expect(plain).not.toContain("isConditionalMediationAvailable");
    expect(plain).not.toContain('"conditional"');
    expect(plain).not.toContain("AbortController");
    expect(conditional).toContain("isConditionalMediationAvailable");
    expect(conditional).toContain('"conditional"');
    expect(conditional).toContain("AbortController");
    expect(passkeyLoginScript(true)).not.toBe(passkeyLoginScript(false));
  });

  it("hints the username field for autofill only in conditional mode", () => {
    expect(passwordLoginPageHtml("/", undefined, CONDITIONAL)).toContain(
      'autocomplete="username webauthn"',
    );
    expect(passwordLoginPageHtml("/", undefined, ENABLED)).toContain('autocomplete="username"');
    expect(passwordLoginPageHtml("/", undefined, CONDITIONAL)).toContain(
      'autocomplete="current-password"',
    );
  });

  it("leaves the password path identical in both modes", () => {
    for (const options of [ENABLED, CONDITIONAL]) {
      const html = passwordLoginPageHtml("/", FAILURE, options);
      expect(html).toMatch(/<form method="post" action="\/auth\/login">/);
      expect(html).toContain('name="password"');
      expect(html).toContain(`id="err" role="alert"`);
    }
  });

  it("only shows the button after feature detection (early return leaves it hidden)", () => {
    const script = passkeyLoginScript(false);
    expect(script).toContain("window.PublicKeyCredential");
    expect(script).toMatch(
      /if \(!cred \|\| !navigator\.credentials \|\| !navigator\.credentials\.get\) return;/,
    );
    expect(script).toContain("btn.hidden = false");
  });
});

describe("passkey entry: script and style budgets", () => {
  it("emits syntactically valid inline scripts in both modes", () => {
    for (const options of [ENABLED, CONDITIONAL]) {
      for (const body of scriptBodies(passwordLoginPageHtml("/", undefined, options))) {
        expect(() => new Script(body)).not.toThrow();
      }
    }
  });

  it("keeps the added CSS within +0.5 KiB and the 6 KiB page budget", () => {
    expect(Buffer.byteLength(PASSKEY_STYLE)).toBeLessThanOrEqual(512);
    expect(Buffer.byteLength(CARD_STYLE) + Buffer.byteLength(PASSKEY_STYLE)).toBeLessThanOrEqual(
      6144,
    );
    expect(passwordLoginPageHtml("/", undefined, ENABLED)).toContain(PASSKEY_STYLE);
    expect(passwordLoginPageHtml("/")).not.toContain(PASSKEY_STYLE);
  });

  it("does not grow the non-passkey pages at all", () => {
    expect(totpChallengePageHtml("/")).not.toContain("Sign in with a passkey");
    expect(loginPageHtml("/")).not.toContain("Sign in with a passkey");
  });
});
