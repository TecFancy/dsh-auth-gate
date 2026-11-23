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

/**
 * `integration.host-auth.test.ts` 的共享装配：一个按 DSH 0.2.3-alpha.2 契约实现的假
 * `connection` 宿主插件（`webserver/authorize` bail + `connection.authentication` 注册表 +
 * `createPeer`），加上真 cordis / 真 alpha.2 `WebServer` / 真 storage 栈。
 *
 * 两个服务分开 provide（`connection` 与 `connection.authentication`）：Cordis 4.2 拒绝在
 * 未注入嵌套服务的上下文里读取它，插件自己也必须同时注入两者。
 *
 * 这个假宿主的 `webserver/authorize` 不复制真实的 Host/Origin 围栏（真实 `dsh-client-connection`
 * 在策略之前先回 403）：围栏属于宿主监听器，本插件不注册它，所以这里不覆盖那一段。三条断言
 * （登录跳转、带 Peer 的索引渲染、`/api` 401）都会在 Provider 或兜底适配器缺失时失败。
 */
export type RealServer = WrappableServer & { readonly port: number };

export const INDEX_HTML = "<html><body>app shell</body></html>";
const TEST_PASSWORD = "s3cret-pw";
/** 受限会话账号：登录拿到 `password-change-only` 会话，只能改密。 */
export const RESTRICTED_USER = "mustchange";
export const RESTRICTED_PASSWORD = "s3cret-pw-restricted";

interface HostPeer {
  readonly id: string;
  readonly principal: { readonly kind: "owner" };
  readonly signal: AbortSignal;
  dispose(): Promise<void>;
}

interface HostProvider {
  authenticate(request: { headers: Record<string, string> }): HostPeer | undefined;
}

export const fakeConnection = {
  name: "fake-connection",
  inject: ["webServer"] as const,
  apply(ctx: Context): void {
    const providers: HostProvider[] = [];
    let created = 0;
    const connection = {
      authentication: {
        // 与 dsh-client-connection 的 d.ts 一致：同步返回一个异步 disposer。
        register(provider: HostProvider): () => Promise<void> {
          providers.push(provider);
          return () => {
            const at = providers.indexOf(provider);
            if (at !== -1) providers.splice(at, 1);
            return Promise.resolve();
          };
        },
      },
      createPeer(): HostPeer {
        created += 1;
        const lifetime = new AbortController();
        return {
          id: `peer-${created}`,
          principal: { kind: "owner" },
          signal: lifetime.signal,
          dispose: () => {
            lifetime.abort(new Error("peer disposed"));
            return Promise.resolve();
          },
        };
      },
    };
    ctx.provide("connection.authentication", connection.authentication);
    ctx.provide("connection", connection);
    ctx.on("webserver/authorize", (request, policy) => {
      if (policy === "anonymous") return { kind: "allow" };
      if (policy === "deny") return { kind: "deny", status: 403 };
      const headers = request.headers as Record<string, string>;
      for (const provider of providers) {
        const peer = provider.authenticate({ headers });
        if (peer !== undefined) return { kind: "allow", peer };
      }
      return { kind: "deny", status: 401 };
    });
  },
};

export interface MountedHost {
  readonly ctx: Context;
  readonly base: string;
  readonly traffic: { readonly index: number; readonly api: number };
  dispose(): Promise<void>;
}

export async function mountHost(): Promise<MountedHost> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-hostauth-"));
  const usersFile = join(root, "users.yaml");
  await writeUsersFile(usersFile, {
    users: new Map([
      ["admin", { passwordHash: await hashPassword(TEST_PASSWORD), disabled: false }],
      [
        RESTRICTED_USER,
        {
          passwordHash: await hashPassword(RESTRICTED_PASSWORD),
          disabled: false,
          mustChangePassword: true,
        },
      ],
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
  const traffic = { index: 0, api: 0 };
  mountHostRoutes(server, traffic);
  fibers.push(await ctx.plugin(fakeConnection));
  fibers.push(
    await ctx.plugin(
      { name, inject, apply, Config },
      { telemetry: false, mode: "password", cookieSecure: false, usersFile },
    ),
  );
  return {
    ctx,
    base: `http://127.0.0.1:${server.port}`,
    traffic,
    dispose: async () => {
      for (const fiber of [...fibers].reverse()) await fiber.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** 与 alpha.2 官方组合同形的三条入口：`/` 索引（required）、`/api` 前缀（required）、WS。 */
function mountHostRoutes(server: RealServer, traffic: { index: number; api: number }): void {
  server.registerFallback({
    auth: (request) => (request.url.pathname === "/" ? "required" : "anonymous"),
    resource: (_request, peer) => {
      traffic.index += 1;
      return Promise.resolve(
        new Response(INDEX_HTML, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-probe-peer": peer === undefined ? "none" : "seen",
          },
        }),
      );
    },
  });
  server.register({
    kind: "prefix",
    path: "/api",
    auth: "required",
    handler: (_req, res, peer) => {
      traffic.api += 1;
      res.writeHead(peer === undefined ? 500 : 200, { "content-type": "text/plain" });
      res.end(peer === undefined ? "missing peer" : "api ok");
    },
  });
  server.registerUpgrade({
    path: "/api/remote.mux",
    auth: "required",
    handler: (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
  });
}

/** 真实口令登录，返回会话 cookie（`name=value` 形式）。 */
export async function login(
  base: string,
  username = "admin",
  password = TEST_PASSWORD,
): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) throw new Error("no session cookie issued");
  return cookie;
}
