/**
 * 登录卡片 notice 槽渲染（P1.1 / D24，shared 层）。
 *
 * 这一层只管"给了文案就渲染、一律转义、不占错误槽"；「谁能给」由
 * `features/password/login-notice.ts` 的白名单决定（shared 是叶子，不反过来依赖 feature）。
 */
import { describe, expect, it } from "vitest";
import { passwordLoginPageHtml, totpChallengePageHtml } from "./login-page.js";

const NOTICE = "Your password was changed. Sign in with your new password.";
const CARD = { notice: NOTICE };

describe("login card notice slot", () => {
  it("renders the notice in its own status slot (not the error slot)", () => {
    const html = passwordLoginPageHtml("/", undefined, CARD);
    expect(html).toContain(`<p class="notice" role="status">${NOTICE}</p>`);
    expect(html).not.toContain('id="err"');
    expect(html).not.toContain('class="error"');
  });

  it("omits the slot when no notice is given (0.14.3 页面不变)", () => {
    const html = passwordLoginPageHtml("/", undefined, {});
    expect(html).not.toContain('class="notice"');
    expect(html).toContain('class="hint"');
    expect(html).toContain('name="username"');
  });

  it("writes the notice before the error so a hypothetical pair reads原因在前", () => {
    const html = passwordLoginPageHtml("/", "Invalid username or password.", {
      notice: NOTICE,
    });
    expect(html.indexOf('class="notice"')).toBeLessThan(html.indexOf('class="error"'));
    // 错误槽仍只承载真正的失败文案
    expect(html).toContain(
      '<p class="error" id="err" role="alert">Invalid username or password.</p>',
    );
  });

  it("escapes the notice even though only server constants may reach it", () => {
    const html = passwordLoginPageHtml("/", undefined, {
      notice: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("can render a notice on the challenge card, but the endpoint never passes one (P1.1 只挂密码卡)", () => {
    expect(totpChallengePageHtml("/", undefined, { who: "alice" })).not.toContain('class="notice"');
    expect(totpChallengePageHtml("/", undefined, { who: "alice", notice: NOTICE })).toContain(
      NOTICE,
    );
  });
});
