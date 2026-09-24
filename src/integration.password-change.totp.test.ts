import { describe, expect, it } from "vitest";
import {
  changeBody,
  changePassword,
  OLD_PASSWORD,
  mountPasswordChangeStack,
  NEW_PASSWORD,
  stillAuthenticated,
  storedHash,
  unmountStack,
} from "./integration-password-change-helpers.js";
import { cookiePair, currentCode, postLogin } from "./integration-totp-helpers.js";

/** 固定测试 secret（RFC 6238 文档用的 base32，够 80 bit）。 */
const SECRET = "JBSWY3DPEHPK3PXP";
/** TOTP 模式出错时必定要看到的状态与 body（不得退化成 401 invalid_credentials）。 */
const INVALID_TOTP = { status: 401, json: { error: "invalid_totp" } };
/** TOTP 失败一律不得写盘：旧口令必须仍然可用。 */
const LOGIN_BODY = `username=admin&password=${encodeURIComponent(OLD_PASSWORD)}`;

/** 两段式登录（密码 → 验证码），返回会话 cookie 与被消费的 code。 */
async function loginWithTotp(
  base: string,
): Promise<{ cookie: string; code: string; challenge: string }> {
  const stage1 = await postLogin(base, LOGIN_BODY);
  expect(stage1.status).toBe(302);
  const challenge = cookiePair(stage1.cookies, "dsh_auth_challenge");
  expect(challenge).toBeDefined();
  const code = currentCode(SECRET);
  const stage2 = await postLogin(base, `code=${code}&next=%2F__probe`, challenge);
  expect(stage2.status).toBe(302);
  // 第二段同时清挑战 cookie 并下发会话 cookie，必须按名字取（首个 set-cookie 是清挑战）。
  const session = cookiePair(stage2.cookies, "dsh_auth");
  expect(session).toBeDefined();
  return { cookie: session!, code, challenge: challenge! };
}

describe("integration: password change with TOTP enabled (real stack)", () => {
  it("rejects a missing code, a wrong code, and a login-consumed code in the same window", async () => {
    const stack = await mountPasswordChangeStack({ totp: "optional", totpSecret: SECRET });
    try {
      const { base, usersFile } = stack;
      const before = await storedHash(usersFile);
      const { cookie, code } = await loginWithTotp(base);
      expect(await stillAuthenticated(base, cookie)).toBe(true);

      // 缺码：TOTP 用户不能只凭会话 cookie 改密
      const missing = await changePassword(base, cookie, changeBody(OLD_PASSWORD, NEW_PASSWORD));
      expect(missing.status).toBe(INVALID_TOTP.status);
      expect(missing.json).toEqual(INVALID_TOTP.json);

      // 错码
      const wrong = await changePassword(
        base,
        cookie,
        changeBody(OLD_PASSWORD, NEW_PASSWORD, "000000"),
      );
      expect(wrong.status).toBe(INVALID_TOTP.status);
      expect(wrong.json).toEqual(INVALID_TOTP.json);

      // 同窗重放：登录刚用掉的 counter 再提交改密 → 拒（共用同一 replayGuard 单例）
      const replay = await changePassword(
        base,
        cookie,
        changeBody(OLD_PASSWORD, NEW_PASSWORD, code),
      );
      expect(replay.status).toBe(INVALID_TOTP.status);
      expect(replay.json).toEqual(INVALID_TOTP.json);

      // 三次失败都不得写盘，会话也未被吊销
      expect(await storedHash(usersFile)).toBe(before);
      expect(await stillAuthenticated(base, cookie)).toBe(true);
    } finally {
      await unmountStack(stack);
    }
  });

  it("rejects a change in required mode when the user has no secret", async () => {
    const stack = await mountPasswordChangeStack({ totp: "required" });
    try {
      const { ctx, base, usersFile } = stack;
      const before = await storedHash(usersFile);
      // required 模式无 secret 的用户登不进来；直接建一个存量会话模拟"旧会话"。
      const store = ctx.get("auth")!.sessions!;
      const issued = await store.create("admin", 600_000);
      const cookie = `dsh_auth=${issued.token}`;
      expect(await stillAuthenticated(base, cookie)).toBe(true);

      const res = await changePassword(base, cookie, changeBody(OLD_PASSWORD, NEW_PASSWORD));
      expect(res.status).toBe(INVALID_TOTP.status);
      expect(res.json).toEqual(INVALID_TOTP.json);
      expect(await storedHash(usersFile)).toBe(before);
    } finally {
      await unmountStack(stack);
    }
  });
});
