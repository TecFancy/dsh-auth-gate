import { describe, expect, it } from "vitest";
import { hashPassword } from "./features/password/index.js";
import { writeUsersFile } from "./shared/index.js";
import {
  cookiePair,
  currentCode,
  mountTotpStack,
  postLogin,
  TEST_PASSWORD,
  unmountStack,
} from "./integration-totp-helpers.js";

/** 内联两步登录（twoStageLogin 作为带断言的 helper 留在 integration.totp.test.ts）。 */
async function inlineTwoStage(base: string, secret: string): Promise<string> {
  const stage1 = await postLogin(base, `username=admin&password=${TEST_PASSWORD}&next=%2F__probe`);
  expect(stage1.status).toBe(302);
  const challengeCookie = cookiePair(stage1.cookies, "dsh_auth_challenge");
  expect(challengeCookie).toBeDefined();
  const stage2 = await postLogin(
    base,
    `code=${currentCode(secret)}&next=%2F__probe`,
    challengeCookie,
  );
  expect(stage2.status).toBe(302);
  const sessionCookie = cookiePair(stage2.cookies, "dsh_auth");
  expect(sessionCookie).toBeDefined();
  return sessionCookie!;
}

describe("integration: TOTP hardening (review P0/P1)", () => {
  it("required mode: unknown user is rejected uniformly with 401", async () => {
    const { port, fibers, root } = await mountTotpStack({ totp: "required" });
    try {
      const base = `http://127.0.0.1:${port}`;
      const login = await postLogin(base, `username=mallory&password=${TEST_PASSWORD}`);
      expect(login.status).toBe(401);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("required mode: secret-bearing user completes the full two-stage login", async () => {
    const { port, fibers, root, totpSecret } = await mountTotpStack({ totp: "required" });
    try {
      const base = `http://127.0.0.1:${port}`;
      const session = await inlineTwoStage(base, totpSecret);
      expect(session.length).toBeGreaterThan(0);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("disabled user with a TOTP secret is blocked at the password stage", async () => {
    const { port, fibers, root, usersFile, totpSecret } = await mountTotpStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      // 重写 users 文件：admin 保留 secret 但置 disabled（插件每次请求重读文件，立即生效）
      const adminHash = await hashPassword(TEST_PASSWORD);
      await writeUsersFile(usersFile, {
        users: new Map([["admin", { passwordHash: adminHash, totpSecret, disabled: true }]]),
      });
      const login = await postLogin(base, `username=admin&password=${TEST_PASSWORD}`);
      expect(login.status).toBe(401);
      expect(cookiePair(login.cookies, "dsh_auth")).toBeUndefined();
      expect(cookiePair(login.cookies, "dsh_auth_challenge")).toBeUndefined();
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
