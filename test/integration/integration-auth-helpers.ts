import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WrappableServer } from "../../src/host/shared/guard/index.js";
import { apply, Config, inject, name, type AuthConfig } from "../../src/index.js";

/**
 * `integration.auth.test.ts` 的共享装配夹具：真实 cordis + webserver + storage 栈，
 * 外加探针路由（`/__probe`、`/`）与一条 WS 升级路由。`connection` 选项再提供一个假
 * connection（模拟 dsh client-connection 的 `authenticatedUrl`），用于 launch-token 桥。
 */

export type RealServer = WrappableServer & { readonly port: number };

export function upgradeRequest(
  port: number,
  headers: Record<string, string>,
): Promise<number | "upgrade"> {
  return new Promise((resolve, reject) => {
    const req = request({
      port,
      host: "127.0.0.1",
      path: "/events",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==",
        "Sec-WebSocket-Version": "13",
        ...headers,
      },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("upgrade", () => resolve("upgrade"));
    req.on("error", reject);
    req.end();
  });
}

export async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 首次引导的测试要能读回「向导写进去的那枚 token」，所以可写凭据服务单独一档。 */
export interface MountStackOptions {
  withCredentials: boolean;
  /**
   * 假 dsh connection 的形状：`authenticatedUrl` = dsh ≥ 0.1.2-alpha；`bare` = 服务在但没有
   * 这个函数（旧版 dsh），桥应回落到 `next`。刻意在插件 apply **之后**才 provide，
   * 用来锁住桥「登录时才 `ctx.get("connection")`」的惰性查找（晚注册的 connection 同样有效）。
   */
  connection?: "authenticatedUrl" | "bare";
  /** 认证流（默认 token）；password 模式需要 `usersFile`（默认落在临时目录里）。 */
  mode?: "token" | "password";
  /** password 模式的 users.yaml 路径；缺省用临时目录下的一份（绝不碰真实 DSH_HOME）。 */
  usersFile?: string;
  /** 提供带 `set` 的可写凭据服务（`resolve` 读同一份内存表），用于首次配置写 token。 */
  writableCredentials?: boolean;
  /** 反钓鱼 host / CSRF 的公开来源（默认空串，即只用 Sec-Fetch-Site 通道）。 */
  publicHost?: string;
}

export interface MountedStack {
  ctx: Context;
  port: number;
  fibers: Fiber[];
  root: string;
  token: string | undefined;
  usersFile: string;
  /** 可写凭据服务的落点（`writableCredentials` 时存在）；token 写到这里。 */
  credentialsStore: Map<string, string> | undefined;
}

export async function mountStack(options: MountStackOptions): Promise<MountedStack> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-it-"));
  const ctx = new Context();
  const mode = options.mode ?? "token";
  const usersFile = options.usersFile ?? join(root, "auth", "users.yaml");
  const token = options.withCredentials ? randomBytes(24).toString("base64url") : undefined;
  let credentialsStore: Map<string, string> | undefined;
  if (options.writableCredentials === true) {
    credentialsStore = new Map();
    const store = credentialsStore;
    ctx.provide("credentials", {
      resolve: (ref: string) => {
        const value = store.get(ref);
        return Promise.resolve(value === undefined ? undefined : { value, source: "test" });
      },
      set: (ref: string, value: string) => {
        store.set(ref, value);
        return Promise.resolve();
      },
    });
  } else if (options.withCredentials) {
    ctx.provide("credentials", {
      resolve: (ref: string) =>
        ref === "DSH_AUTH_TOKEN"
          ? Promise.resolve({ value: token, source: "test" })
          : Promise.resolve(undefined),
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
      cookieSecure: false,
      mode,
      usersFile: mode === "password" ? usersFile : "",
      publicHost: options.publicHost ?? "",
    } as AuthConfig),
  );
  const server = ctx.get("webServer") as unknown as RealServer;
  registerProbes(server);
  server.registerUpgrade({
    path: "/events",
    handler: (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
  });
  await waitFor(() => ctx.get("auth")!.sessions !== undefined);
  // 假 connection 在插件 apply 之后才注册（见 options.connection 注释）。
  if (options.connection === "authenticatedUrl") {
    ctx.provide("connection", {
      // host 与额外 query 都被桥丢弃，只留 token（D-bridge-1）。
      authenticatedUrl: () => "http://other.example:9999/deep/path?extra=1&token=launchTok-it",
    });
  }
  if (options.connection === "bare") ctx.provide("connection", {});
  return { ctx, port: server.port, fibers, root, token, usersFile, credentialsStore };
}

/**
 * 探针路由：`/__probe` 用于鉴权探测，`/` 用于观察「桥把浏览器送去 `/?token=` 之后，
 * 门还认不认那张会话 cookie」。
 */
function registerProbes(server: RealServer): void {
  server.register({
    kind: "exact",
    path: "/__probe",
    handler: (_req, res) => {
      res.writeHead(200);
      res.end("probe");
    },
  });
  server.register({
    kind: "exact",
    path: "/",
    handler: (_req, res) => {
      res.writeHead(200);
      res.end("index");
    },
  });
}

export async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}
