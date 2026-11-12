/**
 * 注册/管理集成测试的真栈装配（与 `integration.passkey.test.ts` 同款，但多一个 admin 用户
 * 与口令登录拿会话的入口）。单独成文件是为了守住 250 行上限。
 */
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { WrappableServer } from "../../src/host/shared/guard/index.js";
import { apply, Config, inject, name } from "../../src/index.js";
import { hashPassword } from "../../src/host/features/password/index.js";
import { writeUsersFile } from "../../src/host/entities/user/index.js";

type RealServer = WrappableServer & { readonly port: number };

/** 测试口令（两个 seeded 用户共用）。 */
export const TEST_PASSWORD = "s3cret-pw";

/** 真栈的 RP ID（由 `publicHost` 的 hostname 派生）。 */
export const RP_ID = "localhost";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 真栈句柄：端口、origin、users.yaml 路径与待释放的 fiber。 */
export interface ManageStack {
  readonly fibers: Fiber[];
  readonly root: string;
  readonly usersFile: string;
  readonly base: string;
  readonly origin: string;
}

/** 先挂 WebServer（port 0）拿端口，再用它拼 `publicHost` 构造 auth 插件配置。 */
export async function mountManageStack(): Promise<ManageStack> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-pk-manage-"));
  const usersFile = join(root, "users.yaml");
  await writeUsersFile(usersFile, {
    users: new Map([
      ["alice", { passwordHash: await hashPassword(TEST_PASSWORD), disabled: false }],
      ["root", { passwordHash: await hashPassword(TEST_PASSWORD), disabled: false, role: "admin" }],
    ]),
  });
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
  const server = ctx.get("webServer") as unknown as RealServer;
  const origin = `http://localhost:${server.port}`;
  fibers.push(
    await ctx.plugin(
      { name, inject, apply, Config },
      {
        telemetry: false,
        mode: "password",
        cookieSecure: false,
        usersFile,
        publicHost: origin,
        passkey: "optional",
        passkeyConditionalUi: false,
      },
    ),
  );
  await waitFor(() => ctx.get("auth")!.sessions !== undefined);
  return { fibers, root, usersFile, base: `http://127.0.0.1:${server.port}`, origin };
}

/** 释放真栈并删除临时目录。 */
export async function unmountStack(stack: ManageStack): Promise<void> {
  for (const fiber of [...stack.fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(stack.root, { recursive: true, force: true });
}

/** 口令登录拿会话 cookie（`dsh_auth=...`）。 */
export async function passwordLogin(base: string, username: string): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(TEST_PASSWORD)}`,
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toMatch(/^dsh_auth=/);
  return cookie!;
}

/** 同源请求头（Origin 通道；`publicHost` 带 scheme，因此精确匹配）。 */
export function sameOrigin(origin: string): Record<string, string> {
  return { origin, "sec-fetch-site": "same-origin" };
}
