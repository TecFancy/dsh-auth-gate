import { describe, expect, it } from "vitest";
import { makeHarness, post, type Harness } from "../../../test/password-totp-harness.js";

/**
 * D20：失败响应从 text/plain 裸文本改成登录卡片 HTML。这里只覆盖「失败页内容与反枚举」，
 * 状态码/限速计数由既有 login / login-rate / totp-stage* 用例守。
 */
describe("POST /auth/login: failure page (D20)", () => {
  async function reject(
    body: string,
    setup?: (harness: Harness) => void,
  ): Promise<{ status: number | undefined; headers: Record<string, string>; body: string }> {
    const h = makeHarness();
    setup?.(h);
    return post(h, "POST", body);
  }

  it("renders one identical HTML body for unknown user, wrong password and disabled account", async () => {
    const unknown = await reject("username=alice&password=x", (h) => h.users.delete("alice"));
    const wrong = await reject("username=alice&password=x");
    const disabled = await reject("username=alice&password=pw", (h) => {
      h.users.set("alice", { passwordHash: "h-alice", disabled: true });
    });
    for (const res of [unknown, wrong, disabled]) {
      expect(res.status).toBe(401);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain('class="error"');
    }
    // 反枚举：三态正文逐字相同（用户名相同 → 整页相同）
    expect(wrong.body).toBe(unknown.body);
    expect(disabled.body).toBe(unknown.body);
  });

  it("escapes the echoed username and prefixes the title with Error:", async () => {
    const payload = 'a"><script>alert(1)</script>';
    const res = await reject(`username=${encodeURIComponent(payload)}&password=x`);
    expect(res.status).toBe(401);
    expect(res.body).toContain("<title>Error: Sign in - dsh-auth-gate</title>");
    expect(res.body).toContain('value="a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(res.body).not.toContain(payload);
  });

  it("marks both fields invalid, keeps next escaped and never echoes the password", async () => {
    const res = await reject("username=alice&password=sup3r-secret&next=%2Fx%3Fa%3D1%26b%3D2");
    expect(res.body).toContain('aria-invalid="true" aria-describedby="err"');
    expect(res.body).toContain('value="/x?a=1&amp;b=2"');
    expect(res.body).not.toContain("sup3r-secret");
  });

  it("ships the pending-state script while no-JS still submits", async () => {
    const res = await reject("username=alice&password=x");
    expect(res.body).toContain("history.replaceState");
    expect(res.body).toContain("Signing in...");
    expect(res.body).toContain("pageshow");
  });

  it("trims the username before lookup so a trailing space still signs in", async () => {
    const res = await reject("username=%20alice%20&password=pw", (h) => h.setTotpMode("off"));
    expect(res.status).toBe(302);
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
  });

  it("does not trim the password (leading/trailing spaces are significant)", async () => {
    const res = await reject("username=alice&password=%20pw%20", (h) => h.setTotpMode("off"));
    expect(res.status).toBe(401);
  });
});
