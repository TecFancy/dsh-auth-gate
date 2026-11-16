/**
 * `passkey: "required"`（passkey-only，issue #133）的端点行为。
 *
 * 这一层钉住的是**服务端强制**，不是 UI：口令分支与 TOTP 挑战分支都必须在读 users.yaml
 * 之前拒绝，且拒绝响应与输入无关（无枚举侧信道）。TOTP 分支单独测，因为它不经过密码校验，
 * 只要手里有合法挑战 cookie 就能凭验证码换会话 - 那是最容易漏的绕过口。
 */
import { describe, expect, it } from "vitest";
import { registerPasswordEndpoints } from "./password-endpoints.js";
import { LOGIN_PATH } from "../../../shared/protocol/index.js";
import { PASSKEY_ONLY_DISABLED_TEXT } from "../ui/login-failure-pages.js";
import { PASSKEY_ONLY_HINT } from "../../../shared/login-page/index.js";

/**
 * 卡片文案里的撇号会被 `escapeHtml` 转成 `&#39;`，所以断言用转义后的形状。
 * 直接比原文会在「device's」这类词上假失败。
 */
const HINT_HTML = PASSKEY_ONLY_HINT.replace(/'/g, "&#39;");
import { buildChallengeValue, CHALLENGE_COOKIE } from "../model/challenge-cookie.js";
import {
  handlerOf,
  loginGetReq,
  loginReq,
  makeHarness,
  makeRes,
  type Harness,
} from "../../../../../test/password-login-harness.js";

/** 打开 passkey-only 的 harness（其余与默认一致）。 */
function passkeyOnlyHarness(): Harness {
  const harness = makeHarness();
  harness.deps.passwordLoginDisabled = true;
  registerPasswordEndpoints(harness.deps);
  return harness;
}

/** 默认（口令可用）的 harness，已注册路由。 */
function defaultHarness(): Harness {
  const harness = makeHarness();
  registerPasswordEndpoints(harness.deps);
  return harness;
}

/** 一个合法的 TOTP 挑战 cookie（HMAC 用 harness 的测试密钥签）。 */
function challengeCookie(harness: Harness, username = "alice"): string {
  const expires = harness.deps.now() + 60_000;
  const value = buildChallengeValue(username, expires, harness.deps.challengeMacKey);
  return `${CHALLENGE_COOKIE}=${value}`;
}

describe("passkey-only: password branch", () => {
  it("rejects a correct password with 403 and never reads users.yaml", async () => {
    const harness = passkeyOnlyHarness();
    const res = makeRes();
    await handlerOf(harness, "exact", LOGIN_PATH)(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(403);
    expect(res.body).toContain(PASSKEY_ONLY_DISABLED_TEXT);
    // 读盘与 scrypt 都没发生：拒绝发生在策略判定，不是凭据判定。
    expect(harness.verifyCalls).toHaveLength(0);
  });

  it("answers identically for a wrong password and an unknown user", async () => {
    const harness = passkeyOnlyHarness();
    const bodies: string[] = [];
    for (const body of ["username=alice&password=wrong", "username=nobody&password=x"]) {
      const res = makeRes();
      await handlerOf(harness, "exact", LOGIN_PATH)(loginReq(body), res.res);
      expect(res.status).toBe(403);
      bodies.push(res.body);
    }
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("issues no session cookie", async () => {
    const harness = passkeyOnlyHarness();
    const res = makeRes();
    await handlerOf(harness, "exact", LOGIN_PATH)(loginReq("username=alice&password=pw"), res.res);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(harness.table.size).toBe(0);
  });

  it("keeps password login working when the flag is absent", async () => {
    const harness = defaultHarness();
    const res = makeRes();
    await handlerOf(harness, "exact", LOGIN_PATH)(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(302);
    expect(harness.table.size).toBe(1);
  });
});

describe("passkey-only: TOTP challenge branch", () => {
  it("rejects a valid challenge cookie + code without issuing a session", async () => {
    const harness = passkeyOnlyHarness();
    harness.deps.totpMode = "optional";
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      LOGIN_PATH,
    )(loginReq("username=alice&code=123456", "127.0.0.1", "/auth/login"), res.res);
    // 没有挑战 cookie 时它落回密码分支，同样 403。
    expect(res.status).toBe(403);
    expect(harness.table.size).toBe(0);
  });

  it("rejects the challenge path even with a signed cookie in hand", async () => {
    const harness = passkeyOnlyHarness();
    harness.deps.totpMode = "optional";
    harness.deps.verifyTotp = () => 42;
    const res = makeRes();
    const req = loginReq("username=alice&code=123456");
    (req.headers as Record<string, string>)["cookie"] = challengeCookie(harness);
    await handlerOf(harness, "exact", LOGIN_PATH)(req, res.res);
    expect(res.status).toBe(403);
    expect(harness.table.size).toBe(0);
    expect(harness.verifyCalls).toHaveLength(0);
  });
});

describe("passkey-only: GET /auth/login", () => {
  it("renders the passkey-only card with no password field", async () => {
    const harness = passkeyOnlyHarness();
    harness.deps.passkey = () => ({ enabled: true, conditionalUi: false });
    const res = makeRes();
    await handlerOf(harness, "exact", LOGIN_PATH)(loginGetReq("/auth/login"), res.res);
    expect(res.status).toBe(200);
    expect(res.body).toContain(HINT_HTML);
    expect(res.body).toContain('id="passkey-btn"');
    expect(res.body).not.toContain('name="password"');
    expect(res.body).not.toContain('name="username"');
  });

  it("ignores ?stage=password (it must not become a bypass)", async () => {
    const harness = passkeyOnlyHarness();
    harness.deps.passkey = () => ({ enabled: true, conditionalUi: false });
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      LOGIN_PATH,
    )(loginGetReq("/auth/login?stage=password"), res.res);
    expect(res.body).not.toContain('name="password"');
    expect(res.body).toContain(HINT_HTML);
  });

  it("ignores a leftover challenge cookie (no TOTP card)", async () => {
    const harness = passkeyOnlyHarness();
    harness.deps.totpMode = "optional";
    harness.deps.passkey = () => ({ enabled: true, conditionalUi: false });
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      LOGIN_PATH,
    )(loginGetReq("/auth/login", challengeCookie(harness)), res.res);
    expect(res.body).not.toContain('name="code"');
    expect(res.body).toContain(HINT_HTML);
  });

  it("renders a diagnostic card when WebAuthn is unusable", async () => {
    const harness = passkeyOnlyHarness();
    harness.deps.passkey = () => ({ enabled: false, conditionalUi: false });
    harness.deps.passkeyDisabledReason = "rp-id-invalid";
    const res = makeRes();
    await handlerOf(harness, "exact", LOGIN_PATH)(loginGetReq("/auth/login"), res.res);
    expect(res.status).toBe(200);
    expect(res.body).toContain("rp-id-invalid");
    expect(res.body).toContain("Password sign-in stays disabled");
    expect(res.body).not.toContain('name="password"');
  });
});
