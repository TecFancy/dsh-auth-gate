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
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";

/**
 * `integration.auth.test.ts` 的共享装配夹具：真实 cordis + webserver + storage 栈，
 * 外加一个探针路由与一条 WS 升级路由。`withConnection` 再提供一个假 connection
 * （模拟 dsh client-connection 的 `authenticatedUrl`），用于 launch-token 桥。
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

export async function mountStack(options: {
  withCredentials: boolean;
  withConnection?: boolean;
}): Promise<{
  ctx: Context;
  port: number;
  fibers: Fiber[];
  root: string;
  token: string | undefined;
}> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-it-"));
  const ctx = new Context();
  const token = options.withCredentials ? randomBytes(24).toString("base64url") : undefined;
  if (options.withCredentials) {
    ctx.provide("credentials", {
      resolve: (ref: string) =>
        ref === "DSH_AUTH_TOKEN"
          ? Promise.resolve({ value: token, source: "test" })
          : Promise.resolve(undefined),
    });
  }
  if (options.withConnection === true) {
    // 假 connection：模拟 dsh 0.1.2-alpha client-connection 的 authenticatedUrl。
    ctx.provide("connection", {
      authenticatedUrl: (baseUrl: string) => `${baseUrl}/?token=launchTok-it`,
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
    await ctx.plugin({ name, inject, apply, Config }, { cookieSecure: false } as AuthConfig),
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
  return { ctx, port: server.port, fibers, root, token };
}

export async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}
