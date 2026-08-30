import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";
import { hashPassword } from "./features/password/index.js";
import { generateTotpSecret, totpCodeAt } from "./features/totp/index.js";
import { writeUsersFile } from "./shared/index.js";

type RealServer = WrappableServer & { readonly port: number };

const TEST_PASSWORD = "s3cret-pw";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function mountTotpStack(options?: {
  totp?: "off" | "optional" | "required";
  seedTotp?: boolean;
}): Promise<{
  ctx: Context;
  port: number;
  fibers: Fiber[];
  root: string;
  usersFile: string;
  totpSecret: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-totp-"));
  const usersFile = join(root, "users.yaml");
  const totpSecret = generateTotpSecret();
  const adminHash = await hashPassword(TEST_PASSWORD);
  const bobHash = await hashPassword(TEST_PASSWORD);
  const users = new Map<string, { passwordHash: string; totpSecret?: string; disabled: boolean }>([
    ["admin", { passwordHash: adminHash, disabled: false }],
    ["bob", { passwordHash: bobHash, disabled: false }],
  ]);
  if (options?.seedTotp !== false) {
    users.set("admin", { passwordHash: adminHash, totpSecret, disabled: false });
  }
  await writeUsersFile(usersFile, { users });

  const ctx = new Context();
  const fibers: Fiber[] = [];
  fibers.push(await ctx.plugin(Storage));
  fibers.push(
    await ctx.plugin(
      {
        name: storageJson.name,
        inject: storageJson.inject,
        apply: storageJson.apply,
        Config: storageJson.Config,
      },
      { root },
    ),
  );
  fibers.push(
    await ctx.plugin(
      {
        name: storageDomain.name,
        inject: storageDomain.inject,
        apply: storageDomain.apply,
        Config: storageDomain.Config,
      },
      { backend: "json" },
    ),
  );
  fibers.push(await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 }));
  fibers.push(
    await ctx.plugin({ name, inject, apply, Config }, {
      mode: "password",
      cookieSecure: false,
      usersFile,
      totp: options?.totp ?? "optional",
    } as AuthConfig),
  );
  const server = ctx.get("webServer") as unknown as RealServer;
  server.register({
    kind: "exact",
    path: "/__probe",
    handler: (_req, res) => {
      res.writeHead(200);
      res.end("probe");
    },
  });
  await waitFor(() => ctx.get("auth")!.sessions !== undefined);
  return { ctx, port: server.port, fibers, root, usersFile, totpSecret };
}

async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

/** 当前 30s 窗口的 TOTP code（真实实现生成，供端到端流程使用）。 */
function currentCode(secret: string): string {
  return totpCodeAt(secret, Math.floor(Date.now() / 30_000));
}

/** POST /auth/login（带可选 cookie），返回状态 + set-cookie 数组 + 首个 cookie 对 + location。 */
async function postLogin(
  base: string,
  body: string,
  cookie?: string,
): Promise<{
  status: number;
  cookies: string[];
  cookie: string | undefined;
  location: string | null;
}> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body,
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie();
  return {
    status: res.status,
    cookies,
    cookie: cookies[0]?.split(";")[0],
    location: res.headers.get("location"),
  };
}

/** 从 set-cookie 数组中取指定名字的 cookie 对（名=值），供后续请求头复用。 */
function cookiePair(cookies: string[], name: string): string | undefined {
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  return found?.split(";")[0];
}

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
});
