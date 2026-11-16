/**
 * passkey-only 登录卡（`passkey: "required"`，issue #133）。
 *
 * 这一层钉住三件事：卡片里**没有**任何口令字段；无 JS 时不是一张空卡（`<noscript>` 说明）；
 * 不新增 CSS（页面样式预算 6 KiB 只剩 23 字节，复用 `PASSKEY_STYLE`）。
 */
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { CARD_STYLE } from "./login-page-assets.js";
import { PASSKEY_STYLE } from "./passkey-login.js";
import {
  PASSKEY_ONLY_ERROR_TEXT,
  PASSKEY_ONLY_HINT,
  PASSKEY_ONLY_NOSCRIPT,
  passkeyOnlyLoginPageHtml,
  passkeyOnlyUnavailablePageHtml,
} from "./passkey-only-login-page.js";

/** 取整页所有内联 `<script>` 的正文。 */
function scriptBodies(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
}

describe("passkey-only card", () => {
  it("renders no password or username field", () => {
    const html = passkeyOnlyLoginPageHtml("/");
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('name="username"');
    expect(html).not.toContain('type="password"');
    // 口令卡的提交按钮也不该出现：这张卡没有可提交的表单。
    expect(html).not.toContain('action="/auth/login"');
  });

  it("renders the passkey button hidden, the hidden form and the error slot", () => {
    const html = passkeyOnlyLoginPageHtml("/");
    expect(html).toContain(
      '<button type="button" class="passkey" id="passkey-btn" hidden>Sign in with a passkey</button>',
    );
    expect(html).toContain('id="passkey-form"');
    expect(html).toContain('action="/auth/passkey/login"');
    expect(html).toContain(`id="passkey-error"`);
    expect(html).toContain(PASSKEY_ONLY_ERROR_TEXT);
  });

  it("explains itself when JavaScript is off", () => {
    const html = passkeyOnlyLoginPageHtml("/");
    expect(html).toContain("<noscript>");
    expect(html).toContain(PASSKEY_ONLY_NOSCRIPT);
  });

  it("carries the hint and the anti-phishing host block", () => {
    const html = passkeyOnlyLoginPageHtml("/", undefined, { host: "dsh.example.com" });
    expect(html).toContain(PASSKEY_ONLY_HINT.replace(/'/g, "&#39;"));
    expect(html).toContain("dsh.example.com");
  });

  it("escapes next and never reflects request text", () => {
    const html = passkeyOnlyLoginPageHtml('/"><script>alert(1)</script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("emits a syntactically valid inline script", () => {
    for (const body of scriptBodies(passkeyOnlyLoginPageHtml("/"))) {
      expect(() => new Script(body)).not.toThrow();
    }
  });

  it("adds no CSS beyond the existing card and passkey styles", () => {
    const html = passkeyOnlyLoginPageHtml("/");
    expect(html).toContain(CARD_STYLE);
    expect(html).toContain(PASSKEY_STYLE);
    // 预算：CARD_STYLE + PASSKEY_STYLE 已用 6121 / 6144 字节，这张卡不能再加样式。
    expect(Buffer.byteLength(CARD_STYLE) + Buffer.byteLength(PASSKEY_STYLE)).toBeLessThanOrEqual(
      6144,
    );
  });

  it("renders a failure variant with the given constant", () => {
    const html = passkeyOnlyLoginPageHtml("/", PASSKEY_ONLY_ERROR_TEXT);
    expect(html).toContain(PASSKEY_ONLY_ERROR_TEXT);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Error: Sign in - dsh-auth-gate");
  });
});

describe("passkey-only unavailable card", () => {
  it("shows the fixed reason and says password sign-in stays disabled", () => {
    const html = passkeyOnlyUnavailablePageHtml("origin-invalid");
    expect(html).toContain("origin-invalid");
    expect(html).toContain("Password sign-in stays disabled");
    expect(html).not.toContain('name="password"');
  });

  it("does not render a passkey button (the feature is unusable)", () => {
    const html = passkeyOnlyUnavailablePageHtml("public-host-missing");
    expect(html).not.toContain('id="passkey-btn"');
  });
});
