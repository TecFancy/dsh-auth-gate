import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";
import { hashPassword } from "./features/password/index.js";
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

async function mountPasswordStack(options?: {
  usersFile?: string;
  seedUsers?: boolean;
  provideConnection?: boolean;
}): Promise<{ ctx: Context; port: number; fibers: Fiber[]; root: string; usersFile: string }> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-pw-"));
  const usersFile = options?.usersFile ?? join(root, "users.yaml");
  if (options?.seedUsers !== false) {
    const adminHash = await hashPassword(TEST_PASSWORD);
    const disabledHash = await hashPassword(TEST_PASSWORD);
    await writeUsersFile(usersFile, {
      users: new Map([
        ["admin", { passwordHash: adminHash, disabled: false }],
        ["disableduser", { passwordHash: disabledHash, disabled: true }],
      ]),
    });
  }
  const ctx = new Context();
  if (options?.provideConnection === true) {
    // 假 connection：模拟 dsh 0.1.2-alpha client-connection 的 authenticatedUrl
    ctx.provide("connection", {
      authenticatedUrl: () => "http://127.0.0.1:3080/?token=launchTok123",
    });
  }
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
  server.registerUpgrade({
    path: "/events",
    handler: (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
  });
  await waitFor(() => ctx.get("auth")!.sessions !== undefined);
  return { ctx, port: server.port, fibers, root, usersFile };
}

async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

function loginBody(username: string, password: string): string {
  return `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

async function postLogin(
  base: string,
  body: string,
): Promise<{ status: number; cookie: string | undefined; location: string | null }> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    cookie: setCookie?.split(";")[0],
    location: res.headers.get("location"),
  };
}

describe("integration: password flow over real HTTP", () => {
  it("runs the login flow with a session cookie", async () => {
    const { port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const page = await fetch(`${base}/auth/login`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('name="username"');

      const nav = await fetch(`${base}/__probe`, {
        headers: { accept: "text/html" },
        redirect: "manual",
      });
      expect(nav.status).toBe(302);
      expect((await fetch(`${base}/__probe`)).status).toBe(401);

      const bad = await postLogin(base, loginBody("admin", "wrong"));
      expect(bad.status).toBe(401);

      const good = await postLogin(base, `${loginBody("admin", TEST_PASSWORD)}&next=%2F__probe`);
      expect(good.status).toBe(302);
      expect(good.location).toBe("/__probe");
      const cookie = good.cookie!;

      expect((await fetch(`${base}/__probe`, { headers: { cookie } })).status).toBe(200);
      const status = await fetch(`${base}/auth/status`, { headers: { cookie } });
      expect(await status.text()).toBe('{"authenticated":true,"logoutOrder":1000}');
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("accepts a bearer session token and logs out", async () => {
    const { port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const good = await postLogin(base, loginBody("admin", TEST_PASSWORD));
      const cookie = good.cookie!;

      // Bearer 会话 token：从 cookie 里取出的会话 token 直接通过守卫
      const sessionToken = cookie.split("=")[1]!;
      expect(
        (await fetch(`${base}/__probe`, { headers: { authorization: `Bearer ${sessionToken}` } }))
          .status,
      ).toBe(200);
      expect(
        (await fetch(`${base}/__probe`, { headers: { authorization: "Bearer wrong" } })).status,
      ).toBe(401);

      const logout = await fetch(`${base}/auth/logout?next=/`, {
        method: "POST",
        headers: { cookie },
        redirect: "manual",
      });
      expect(logout.status).toBe(302);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      expect((await fetch(`${base}/__probe`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: password login rejection paths", () => {
  it("rejects disabled and unknown users with the same 401", async () => {
    const { port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const disabled = await postLogin(base, loginBody("disableduser", TEST_PASSWORD));
      expect(disabled.status).toBe(401);
      const ghost = await postLogin(base, loginBody("ghost", TEST_PASSWORD));
      expect(ghost.status).toBe(401);
      expect(ghost.cookie).toBeUndefined();
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("rejects with 503 on a broken users file and recovers when fixed", async () => {
    const { port, fibers, root, usersFile } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      await fs.writeFile(usersFile, "version: 1\nusers: [unclosed", { mode: 0o600 });
      const broken = await postLogin(base, loginBody("admin", TEST_PASSWORD));
      expect(broken.status).toBe(503);
      // 恢复后（per-operation 重读，免重启）登录恢复
      const adminHash = await hashPassword(TEST_PASSWORD);
      await writeUsersFile(usersFile, {
        users: new Map([["admin", { passwordHash: adminHash, disabled: false }]]),
      });
      const fixed = await postLogin(base, loginBody("admin", TEST_PASSWORD));
      expect(fixed.status).toBe(302);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: launch-token bridge over real HTTP", () => {
  it("stripes the host/scheme off authenticatedUrl: relative /?token= after login", async () => {
    const { port, fibers, root } = await mountPasswordStack({ provideConnection: true });
    try {
      const base = `http://127.0.0.1:${port}`;
      const good = await postLogin(base, loginBody("admin", TEST_PASSWORD));
      expect(good.status).toBe(302);
      // 只保留 token，host/scheme 全部丢弃（grok-4.6 review F1/F2）
      expect(good.location).toBe("/?token=launchTok123");
      expect(good.cookie).toContain("dsh_auth=");
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: password routing", () => {
  it("answers /auth/* fallback paths with 404 and rejects wrong methods with 405", async () => {
    const { port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      expect((await fetch(`${base}/auth/whatever`)).status).toBe(404);
      const del = await fetch(`${base}/auth/login`, { method: "DELETE" });
      expect(del.status).toBe(405);
      expect(del.headers.get("allow")).toBe("GET, POST");
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
