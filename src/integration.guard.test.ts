import { Context } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import type { Gate, WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";

type RealServer = WrappableServer & { readonly port: number };

function registerRoutes(server: RealServer): void {
  server.register({
    kind: "exact",
    path: "/probe",
    handler: (_req, res) => {
      res.writeHead(200);
      res.end("probe");
    },
  });
  server.register({
    kind: "prefix",
    path: "/pfx",
    handler: (_req, res) => {
      res.writeHead(200);
      res.end("pfx");
    },
  });
  server.registerUpgrade({
    path: "/api/events.host",
    handler: (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
  });
  server.registerFallback((_req, res) => {
    res.writeHead(200);
    res.end("spa");
  });
}

function requestUpgradeStatus(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      port,
      host: "127.0.0.1",
      path: "/api/events.host",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==",
        "Sec-WebSocket-Version": "13",
      },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("upgrade", () => reject(new Error("unexpected upgrade event")));
    req.on("error", reject);
    req.end();
  });
}

describe("integration: real webserver + guard", () => {
  it("guards all four entry classes over real HTTP", async () => {
    const ctx = new Context();
    const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
    const server = ctx.get("webServer") as unknown as RealServer;
    registerRoutes(server);
    const authFiber = await ctx.plugin({ name, inject, apply, Config }, {} as AuthConfig);
    const port = server.port;

    try {
      const base = `http://127.0.0.1:${port}`;
      // M2：插件挂 TokenGate（无凭证恒 deny）；先显式换 allow 门验证守卫放行零扰动。
      ctx.get("auth")!.gate = { decide: () => "allow" };
      expect(await (await fetch(`${base}/probe`)).text()).toBe("probe");
      expect(await (await fetch(`${base}/pfx/x`)).text()).toBe("pfx");
      expect(await (await fetch(`${base}/`)).text()).toBe("spa");

      // Swap in a deny gate: guards must enforce 302/401 on every class.
      const denyGate: Gate = { decide: () => "deny" };
      ctx.get("auth")!.gate = denyGate;

      const nav = await fetch(`${base}/probe`, {
        headers: { accept: "text/html" },
        redirect: "manual",
      });
      expect(nav.status).toBe(302);
      expect(nav.headers.get("location")).toBe("/auth/login?next=%2Fprobe");

      const api = await fetch(`${base}/probe`, {
        headers: { accept: "application/json" },
      });
      expect(api.status).toBe(401);
      expect(await api.text()).toBe("unauthorized");
      expect((await fetch(`${base}/pfx/x`)).status).toBe(401);

      const fallback = await fetch(`${base}/`, {
        headers: { accept: "text/html" },
        redirect: "manual",
      });
      expect(fallback.status).toBe(302);

      // WS upgrade: denied before negotiation (401 response, no 'upgrade' event).
      expect(await requestUpgradeStatus(port)).toBe(401);

      // A route registered after the plugin applies is guarded immediately.
      server.register({
        kind: "exact",
        path: "/late",
        handler: (_req, res) => {
          res.writeHead(200);
          res.end("late");
        },
      });
      expect((await fetch(`${base}/late`)).status).toBe(401);
    } finally {
      await authFiber.dispose();
      await wsFiber.dispose();
    }
  });
});
