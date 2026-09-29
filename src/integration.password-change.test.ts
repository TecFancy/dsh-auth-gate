import { describe, expect, it } from "vitest";
import {
  PASSWORD_CHANGED_NOTICE,
  PASSWORD_CHANGED_TEXT,
  verifyPassword,
} from "./features/password/index.js";
import {
  changeBody,
  changePassword,
  login,
  OLD_PASSWORD,
  mountPasswordChangeStack,
  NEW_PASSWORD,
  SHORT_PASSWORD,
  stillAuthenticated,
  storedHash,
  unmountStack,
} from "./integration-password-change-helpers.js";

describe("integration: self-service password change (happy path)", () => {
  it("changes the password, revokes every session including the current one, and clears the cookie", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const { base, usersFile } = stack;
      const before = await storedHash(usersFile);
      const first = await login(base, OLD_PASSWORD);
      const second = await login(base, OLD_PASSWORD); // 第二台"设备"
      expect(await stillAuthenticated(base, first)).toBe(true);

      const res = await changePassword(base, first, changeBody(OLD_PASSWORD, NEW_PASSWORD));
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ ok: true });
      expect(res.setCookie).toContain("Max-Age=0"); // 清 cookie

      const after = await storedHash(usersFile);
      expect(after).not.toBe(before);
      expect(await verifyPassword(NEW_PASSWORD, after)).toBe(true);

      // 全踢：当前设备与第二台设备的会话都失效
      expect(await stillAuthenticated(base, first)).toBe(false);
      expect(await stillAuthenticated(base, second)).toBe(false);
      expect((await fetch(`${base}/__probe`, { headers: { cookie: first } })).status).toBe(401);

      // 新口令可登、旧口令不可
      const relogin = await login(base, NEW_PASSWORD);
      expect(await stillAuthenticated(base, relogin)).toBe(true);
      const stale = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `username=admin&password=${encodeURIComponent(OLD_PASSWORD)}`,
        redirect: "manual",
      });
      expect(stale.status).toBe(401);
    } finally {
      await unmountStack(stack);
    }
  });

  it("rejects a wrong current password without touching the stored hash or the session", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const { base, usersFile } = stack;
      const before = await storedHash(usersFile);
      const cookie = await login(base, OLD_PASSWORD);

      const res = await changePassword(
        base,
        cookie,
        changeBody("wrong-current-Aa1!", NEW_PASSWORD),
      );
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ error: "invalid_credentials" });
      expect(await storedHash(usersFile)).toBe(before);
      // 未写盘时绝不吊销会话（顺序硬约束）
      expect(await stillAuthenticated(base, cookie)).toBe(true);
    } finally {
      await unmountStack(stack);
    }
  });

  it("rejects a policy-breaking new password and leaves the old one working", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const { base, usersFile } = stack;
      const before = await storedHash(usersFile);
      const cookie = await login(base, OLD_PASSWORD);

      const short = await changePassword(base, cookie, changeBody(OLD_PASSWORD, SHORT_PASSWORD));
      expect(short.status).toBe(400);
      expect(short.json).toEqual({ error: "policy", rules: ["minLength"] });

      const same = await changePassword(base, cookie, changeBody(OLD_PASSWORD, OLD_PASSWORD));
      expect(same.status).toBe(400);
      expect((same.json as { rules: string[] }).rules).toContain("sameAsOld");

      expect(await storedHash(usersFile)).toBe(before);
      expect(await stillAuthenticated(base, cookie)).toBe(true);
    } finally {
      await unmountStack(stack);
    }
  });
});

describe("integration: password change rejection paths", () => {
  it("requires a session cookie (Bearer does not participate) and rejects wrong methods", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const { base } = stack;
      const anon = await changePassword(base, "", changeBody(OLD_PASSWORD, NEW_PASSWORD));
      expect(anon.status).toBe(401);
      expect(anon.json).toEqual({ error: "unauthorized" });

      const cookie = await login(base, OLD_PASSWORD);
      const bearer = await fetch(`${base}/auth/password`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Bearer ${cookie.split("=")[1]}`,
          // P2 §6：先过同源门（缺省 fail-closed），才能测到"只认 cookie"这条。
          "sec-fetch-site": "same-origin",
        },
        body: changeBody(OLD_PASSWORD, NEW_PASSWORD),
        redirect: "manual",
      });
      expect(bearer.status).toBe(401); // 只认 cookie（M5 同款）

      // P2 修订：`/auth/password` 的 allow 由 `POST` 改为 `GET, POST`（GET = SSR 改密页），
      // 405 用真正非法的方法断言（allow 头的逐条断言在 password-endpoints.p2-routes.test.ts）。
      expect((await changePassword(base, cookie, "", "GET")).status).toBe(200);
      expect((await changePassword(base, cookie, "", "PUT")).status).toBe(405);
    } finally {
      await unmountStack(stack);
    }
  });

  it("answers 415 for a non-form content type and 413 for an oversized body", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const { base } = stack;
      const cookie = await login(base, OLD_PASSWORD);

      const json = await fetch(`${base}/auth/password`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ current: OLD_PASSWORD, password: NEW_PASSWORD }),
      });
      expect(json.status).toBe(415);

      const big = await fetch(`${base}/auth/password`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        body: `current=${"a".repeat(20_000)}`,
      });
      expect(big.status).toBe(413);
      expect(big.headers.get("connection")).toBe("close");
    } finally {
      await unmountStack(stack);
    }
  });

  it("locks the password-change bucket after repeated failures, without locking login", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const { base } = stack;
      const cookie = await login(base, OLD_PASSWORD);

      let last = 0;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        last = (await changePassword(base, cookie, changeBody("wrong-current-Aa1!", NEW_PASSWORD)))
          .status;
      }
      expect(last).toBe(429); // 独立桶：改密被锁
      // 登录桶不受影响：正确口令仍可登录（改密限速不得 DoS 登录）
      const relogin = await login(base, OLD_PASSWORD);
      expect(await stillAuthenticated(base, relogin)).toBe(true);
    } finally {
      await unmountStack(stack);
    }
  });

  it("reports 503 on a broken users file and never revokes the session", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const { base, usersFile } = stack;
      const cookie = await login(base, OLD_PASSWORD);
      const { promises: fs } = await import("node:fs");
      await fs.writeFile(usersFile, "version: 1\nusers: [unclosed", { mode: 0o600 });

      const res = await changePassword(base, cookie, changeBody(OLD_PASSWORD, NEW_PASSWORD));
      expect(res.status).toBe(503);
      expect(await stillAuthenticated(base, cookie)).toBe(true);
    } finally {
      await unmountStack(stack);
    }
  });
});

/**
 * P1.1 / D24：改密后客户端把当前设备送回登录页，登录卡要说明原因。
 * 这里用真实 HTTP 串起两侧字面量（客户端不 import 服务端 shared，只能靠测试钉住咬合）。
 */
describe("integration: login notice after a password change (P1.1)", () => {
  it("pins the client redirect key to the server-rendered copy", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      // 客户端半边不 import 服务端 shared（切片门禁 + host 侧 tsconfig 无 DOM lib），两侧各写一份
      // 字面量：用服务端常量打真实 HTTP，客户端那份由下面 source-pin 用例按源码文本对齐。
      const notice = PASSWORD_CHANGED_NOTICE;
      const res = await fetch(`${stack.base}/auth/login?next=%2F&notice=${notice}`, {
        redirect: "manual",
      });
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(html).toContain(`<p class="notice" role="status">${PASSWORD_CHANGED_TEXT}</p>`);
      expect(html).toContain('action="/auth/login"');
    } finally {
      await unmountStack(stack);
    }
  });

  it("never reflects a hostile value and leaves the 401 failure page untouched", async () => {
    const stack = await mountPasswordChangeStack();
    try {
      const hostile = await fetch(
        `${stack.base}/auth/login?notice=${encodeURIComponent("<script>alert(1)</script>")}`,
        { redirect: "manual" },
      );
      const html = await hostile.text();
      expect(html).not.toContain('class="notice"');
      expect(html).not.toContain("alert(1)");

      const failure = await fetch(`${stack.base}/auth/login?notice=password-changed`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=admin&password=definitely-wrong",
        redirect: "manual",
      });
      const failureHtml = await failure.text();
      expect(failure.status).toBe(401);
      expect(failureHtml).toContain("Invalid username or password.");
      expect(failureHtml).not.toContain('class="notice"');
    } finally {
      await unmountStack(stack);
    }
  });

  it("keeps the notice off the TOTP challenge page (只在密码卡上说这件事)", async () => {
    const stack = await mountPasswordChangeStack({
      totp: "required",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    try {
      const stage1 = await fetch(`${stack.base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `username=admin&password=${encodeURIComponent(OLD_PASSWORD)}`,
        redirect: "manual",
      });
      expect(stage1.status).toBe(302);
      const challenge = stage1.headers.get("set-cookie")!.split(";")[0]!;

      const page = await fetch(`${stack.base}/auth/login?notice=password-changed`, {
        headers: { cookie: challenge },
        redirect: "manual",
      });
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain("Two-factor");
      expect(html).not.toContain('class="notice"');
    } finally {
      await unmountStack(stack);
    }
  });
});
