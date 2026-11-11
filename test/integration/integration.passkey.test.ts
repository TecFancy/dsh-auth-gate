import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WrappableServer } from "../../src/host/shared/guard/index.js";
import { apply, Config, inject, name } from "../../src/index.js";
import { hashPassword } from "../../src/host/features/password/index.js";
import { writeUsersFile } from "../../src/host/entities/user/index.js";
import {
  PasskeyAuthenticator,
  randomBase64Url,
  type PasskeyAssertionForm,
} from "../passkey-authenticator-harness.js";

type RealServer = WrappableServer & { readonly port: number };

const TEST_PASSWORD = "s3cret-pw";
const RP_ID = "localhost";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 写一条手工 seeded passkey：`users.yaml` 的 `passkeys[]` 与自造认证器逐字对应。 */
async function seedPasskeyUser(
  usersFile: string,
  authenticator: PasskeyAuthenticator,
): Promise<void> {
  await writeUsersFile(usersFile, {
    users: new Map([
      [
        "alice",
        {
          passwordHash: await hashPassword(TEST_PASSWORD),
          disabled: false,
          passkeyUserHandle: authenticator.userHandle,
          passkeys: [
            {
              credentialId: authenticator.credentialId,
              publicKeyCose: authenticator.publicKeyCose,
              alg: -7,
              signCount: 0,
              aaguid: "",
              be: false,
              bs: false,
              uvInitialized: true,
              transports: ["internal"],
              label: "Test key",
              createdAt: 1,
              lastUsedAt: 0,
            },
          ],
        },
      ],
    ]),
  });
}

/** 先挂存储插件与 WebServer（port 0），返回已监听的服务端（含实际端口）。 */
async function mountServer(ctx: Context, fibers: Fiber[], root: string): Promise<RealServer> {
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
  return ctx.get("webServer") as unknown as RealServer;
}

interface PasskeyStack {
  readonly fibers: Fiber[];
  readonly root: string;
  readonly base: string;
  readonly origin: string;
  readonly authenticator: PasskeyAuthenticator;
}

/**
 * 真栈：先拿 WebServer 的实际端口，再用它拼 `publicHost` 构造 auth 插件配置。
 * `publicHost` 是 RP ID/origin 的唯一锚点（不读请求头 Host），所以必须先有端口。
 */
async function mountPasskeyStack(): Promise<PasskeyStack> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-pk-"));
  const usersFile = join(root, "users.yaml");
  const authenticator = new PasskeyAuthenticator({
    rpId: RP_ID,
    userHandle: randomBase64Url(32),
  });
  await seedPasskeyUser(usersFile, authenticator);
  const ctx = new Context();
  const fibers: Fiber[] = [];
  const server = await mountServer(ctx, fibers, root);
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
  return { fibers, root, base: `http://127.0.0.1:${server.port}`, origin, authenticator };
}

async function unmountStack(stack: PasskeyStack): Promise<void> {
  for (const fiber of [...stack.fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(stack.root, { recursive: true, force: true });
}

/** begin：POST options，返回 challenge + `dsh_auth_pk` cookie。 */
async function beginPasskeyLogin(base: string): Promise<{ challenge: string; cookie: string }> {
  const res = await fetch(`${base}/auth/passkey/options`, { method: "POST", redirect: "manual" });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = (await res.json()) as { challenge: string };
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toMatch(/^dsh_auth_pk=/);
  return { challenge: body.challenge, cookie: cookie! };
}

/** finish：把断言字段按 urlencoded 表单提交，返回原始响应。 */
async function submitAssertion(
  base: string,
  fields: PasskeyAssertionForm,
  cookie: string,
): Promise<{ status: number; location: string | null; setCookie: string; body: string }> {
  const params = assertionFormParams(fields, "/dashboard");
  const res = await fetch(`${base}/auth/passkey/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: params.toString(),
    redirect: "manual",
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookie: res.headers.get("set-cookie") ?? "",
    body: await res.text(),
  };
}

/** 断言字段 → urlencoded 参数（键名与 `PasskeyAssertionRequest` 契约一致）。 */
function assertionFormParams(fields: PasskeyAssertionForm, next: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("id", fields.id);
  params.set("client_data_json", fields.client_data_json);
  params.set("authenticator_data", fields.authenticator_data);
  params.set("signature", fields.signature);
  if (fields.user_handle !== undefined) params.set("user_handle", fields.user_handle);
  params.set("next", next);
  return params;
}

describe("integration: passkey login over a real HTTP stack", () => {
  it("runs begin + finish and issues a session cookie", async () => {
    const stack = await mountPasskeyStack();
    try {
      const begin = await beginPasskeyLogin(stack.base);
      const login = await submitAssertion(
        stack.base,
        stack.authenticator.assert({
          challenge: begin.challenge,
          origin: stack.origin,
          counter: 1,
        }),
        begin.cookie,
      );
      expect(login.status).toBe(302);
      expect(login.location).toBe("/dashboard");
      expect(login.setCookie).toContain("dsh_auth_pk=; Max-Age=0");
      const sessionCookie = /(?:^|,\s*)(dsh_auth=[A-Za-z0-9_-]{43})/.exec(login.setCookie)?.[1];
      expect(sessionCookie).toBeDefined();

      const status = await fetch(`${stack.base}/auth/status`, {
        headers: { cookie: sessionCookie! },
      });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        authenticated: true,
        name: "alice",
        passkeyEnabled: true,
      });
    } finally {
      await unmountStack(stack);
    }
  });

  it("rejects a bad signature with 401 and no session cookie", async () => {
    const stack = await mountPasskeyStack();
    try {
      const begin = await beginPasskeyLogin(stack.base);
      const login = await submitAssertion(
        stack.base,
        stack.authenticator.assert({
          challenge: begin.challenge,
          origin: stack.origin,
          counter: 1,
          badSignature: true,
        }),
        begin.cookie,
      );
      expect(login.status).toBe(401);
      expect(login.body).toContain("Passkey sign-in failed");
      expect(/dsh_auth=[A-Za-z0-9_-]{43}/.test(login.setCookie)).toBe(false);
      const status = await fetch(`${stack.base}/auth/status`);
      expect(await status.json()).toMatchObject({ authenticated: false });
    } finally {
      await unmountStack(stack);
    }
  });
});
