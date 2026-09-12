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
import { writeUsersFile } from "./shared/index.js";

type RealServer = WrappableServer & { readonly port: number };

const TEST_PASSWORD = "s3cret-pw";
/** 测试用扫描间隔：远小于 waitFor 超时，真实路径仍是插件自己的定时器。 */
const SWEEP_MS = 50;

async function mountPasswordStack(): Promise<{
  ctx: Context;
  port: number;
  fibers: Fiber[];
  root: string;
  usersFile: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-revoke-"));
  const usersFile = join(root, "users.yaml");
  await seedUser(usersFile, false);

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
      revokeSweepMs: SWEEP_MS,
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
  return { ctx, port: server.port, fibers, root, usersFile };
}

async function seedUser(usersFile: string, disabled: boolean): Promise<void> {
  await writeUsersFile(usersFile, {
    users: new Map([["admin", { passwordHash: await hashPassword(TEST_PASSWORD), disabled }]]),
  });
}

async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

async function login(base: string): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `username=admin&password=${TEST_PASSWORD}`,
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const cookie = res.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("dsh_auth="))
    ?.split(";")[0];
  expect(cookie).toBeDefined();
  return cookie ?? "";
}

describe("integration: disabling a user revokes live sessions", () => {
  it("rejects a cookie issued before `user disable` once the sweeper runs", async () => {
    const { ctx, port, fibers, root, usersFile } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await login(base);
      expect(await probeStatus(base, cookie)).toBe(200);
      await waitForSessions(ctx);

      // 模拟 `dsh-auth user disable admin`（CLI 只改 users.yaml）
      await seedUser(usersFile, true);

      let status = 200;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        status = await probeStatus(base, cookie);
        if (status === 401) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(status).toBe(401);

      const statusRes = await fetch(`${base}/auth/status`, { headers: { cookie } });
      expect(await statusRes.text()).toBe('{"authenticated":false,"logoutOrder":1000}');
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

function probeStatus(base: string, cookie: string): Promise<number> {
  return fetch(`${base}/__probe`, { headers: { cookie } }).then((res) => res.status);
}

async function waitForSessions(ctx: Context): Promise<void> {
  const start = Date.now();
  while (ctx.get("auth")?.sessions === undefined) {
    if (Date.now() - start > 5_000) throw new Error("timed out waiting for the session layer");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
