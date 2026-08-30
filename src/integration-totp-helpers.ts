import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";
import { hashPassword } from "./features/password/index.js";
import { generateTotpSecret, totpCodeAt } from "./features/totp/index.js";
import { writeUsersFile } from "./shared/index.js";

/** 集成测试共享 helpers（mountTotpStack 等）。测试文件从本模块 import，避免跨 .test.ts import 丢失类型。 */
type RealServer = WrappableServer & { readonly port: number };

export const TEST_PASSWORD = "s3cret-pw";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function mountTotpStack(options?: {
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

export async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

/** 当前 30s 窗口的 TOTP code（真实实现生成，供端到端流程使用）。 */
export function currentCode(secret: string): string {
  return totpCodeAt(secret, Math.floor(Date.now() / 30_000));
}

/** POST /auth/login（带可选 cookie），返回状态 + set-cookie 数组 + 首个 cookie 对 + location。 */
export async function postLogin(
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
export function cookiePair(cookies: string[], name: string): string | undefined {
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  return found?.split(";")[0];
}
