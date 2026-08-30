import {
  cookiePair,
  currentCode,
  mountTotpStack,
  postLogin,
  TEST_PASSWORD,
  unmountStack,
} from "./integration-totp-helpers.js";
export * from "./integration-totp-helpers.js"; // 共享无断言工具给 integration.totp-hardening.test.ts
import { describe, expect, it } from "vitest";
describe("integration: TOTP two-stage flow over real HTTP", () => {
  it("full two-stage login grants access, wrong code is rejected", async () => {
    const { port, fibers, root, totpSecret } = await mountTotpStack();
    try {
      const base = `http://127.0.0.1:${port}`;

      const page = await fetch(`${base}/auth/login`);
      expect(page.status).toBe(200);

      // 密码阶段（带 TOTP 用户）→ 挑战 cookie
      const stage1 = await postLogin(
        base,
        `username=admin&password=${TEST_PASSWORD}&next=%2F__probe`,
      );
      expect(stage1.status).toBe(302);
      const challengeCookie = cookiePair(stage1.cookies, "dsh_auth_challenge");
      expect(challengeCookie).toBeDefined();

      // 挑战 cookie 下渲染挑战页
      const challengePage = await fetch(`${base}/auth/login`, {
        headers: { cookie: challengeCookie },
      });
      expect(challengePage.status).toBe(200);
      expect(await challengePage.text()).toContain('name="code"');

      // 错误 code → 401
      const wrong = await postLogin(base, "code=000000", challengeCookie);
      expect(wrong.status).toBe(401);

      // 正确 code → 会话 cookie + 挑战 cookie 清除
      const good = await postLogin(
        base,
        `code=${currentCode(totpSecret)}&next=%2F__probe`,
        challengeCookie,
      );
      expect(good.status).toBe(302);
      const sessionCookie = cookiePair(good.cookies, "dsh_auth");
      expect(sessionCookie).toBeDefined();
      // 挑战 cookie 已清零（Max-Age=0），不再是有效挑战
      expectCleared(good.cookies, "dsh_auth_challenge");

      // 会话可用
      expect((await fetch(`${base}/__probe`, { headers: { cookie: sessionCookie } })).status).toBe(
        200,
      );
      const status = await fetch(`${base}/auth/status`, { headers: { cookie: sessionCookie } });
      expect(await status.text()).toBe('{"authenticated":true,"logoutOrder":1000}');
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("replays a used code with a fresh challenge cookie: 401 (replay guard)", async () => {
    const { port, fibers, root, totpSecret } = await mountTotpStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const code = currentCode(totpSecret);
      // 同一 code 用两次：先成功一次
      const session = await twoStageLogin(base, "admin", TEST_PASSWORD, totpSecret);
      expect(session.length).toBeGreaterThan(0);

      // 重新走密码阶段拿新挑战 cookie，同一窗口秒级内重放同一 code → 防重放拒绝
      const stage1 = await postLogin(base, `username=admin&password=${TEST_PASSWORD}`);
      const challengeCookie = cookiePair(stage1.cookies, "dsh_auth_challenge");
      const replay = await postLogin(base, `code=${code}`, challengeCookie);
      expect(replay.status).toBe(401);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: TOTP mode variants", () => {
  it("off mode: secret-bearing user still gets a straight session", async () => {
    const { port, fibers, root, totpSecret } = await mountTotpStack({ totp: "off" });
    try {
      const base = `http://127.0.0.1:${port}`;
      void totpSecret;
      const login = await postLogin(base, `username=admin&password=${TEST_PASSWORD}`);
      expect(login.status).toBe(302);
      expect(cookiePair(login.cookies, "dsh_auth")).toBeDefined();
      expect(cookiePair(login.cookies, "dsh_auth_challenge")).toBeUndefined();
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("required mode: user without a secret is blocked with 401", async () => {
    const { port, fibers, root } = await mountTotpStack({ totp: "required", seedTotp: false });
    try {
      const base = `http://127.0.0.1:${port}`;
      const login = await postLogin(base, `username=admin&password=${TEST_PASSWORD}`);
      expect(login.status).toBe(401);
      const raw = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `username=admin&password=${TEST_PASSWORD}`,
        redirect: "manual",
      });
      expect(raw.status).toBe(401);
      expect(await raw.text()).toBe("invalid credentials");
    } finally {
      await unmountStack(fibers, root);
    }
  });
  // 注：本文件不测 token 模式（token 回归由 integration.auth.test.ts 承担，
  // 避免同栈重复起服（规格矩阵 #5 范围限定 password/TOTP）。
  // 硬化的三个用例（required 未知用户 / required 有 secret 完整两段 / disabled
  // 卡密码段）在 integration.totp-hardening.test.ts（复用本文件导出的 helpers）。
});

/** 断言某 cookie 以 Max-Age=0 清零出现在 set-cookie 数组中。 */
function expectCleared(cookies: string[], name: string): void {
  const cleared = cookies.find((c) => c.startsWith(`${name}=`) && c.includes("Max-Age=0"));
  expect(cleared).toBeDefined();
}

/** 两步登录：密码 → 拿走挑战 cookie；code → 会话 cookie。返回会话 cookie。 */
async function twoStageLogin(
  base: string,
  username: string,
  password: string,
  secret: string,
): Promise<string> {
  const stage1 = await postLogin(base, `username=${username}&password=${password}&next=%2F__probe`);
  expect(stage1.status).toBe(302);
  const challengeCookie = cookiePair(stage1.cookies, "dsh_auth_challenge");
  expect(challengeCookie).toBeDefined();
  const stage2 = await postLogin(
    base,
    `code=${currentCode(secret)}&next=%2F__probe`,
    challengeCookie,
  );
  expect(stage2.status).toBe(302);
  expect(stage2.location).toBe("/__probe");
  const sessionCookie = cookiePair(stage2.cookies, "dsh_auth");
  expect(sessionCookie).toBeDefined();
  // 挑战 cookie 以 Max-Age=0 清零（与会话 cookie 同帧下发）
  expectCleared(stage2.cookies, "dsh_auth_challenge");
  return sessionCookie!;
}
