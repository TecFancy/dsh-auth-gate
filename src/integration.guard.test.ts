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

function requestUpgradeStatus(port: number, path = "/api/events.host"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      port,
      host: "127.0.0.1",
      path,
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
        // undici 会把 sec-fetch-mode 强制改写成 "cors"，故导航标记只能用 sec-fetch-dest。
        headers: { accept: "text/html", "sec-fetch-dest": "document" },
        redirect: "manual",
      });
      expect(nav.status).toBe(302);
      expect(nav.headers.get("location")).toBe("/auth/login?next=%2Fprobe");
      // 被拒的 URL 可能自带 launch token：跳登录页时不给下游留 Referer。
      expect(nav.headers.get("referrer-policy")).toBe("no-referrer");

      // P2 §3：Accept 子串匹配已废除（只认 Sec-Fetch）→ 缺头时 fail-closed 按 API 401。
      const acceptOnly = await fetch(`${base}/probe`, { headers: { accept: "text/html" } });
      expect(acceptOnly.status).toBe(401);

      const api = await fetch(`${base}/probe`, {
        headers: { accept: "application/json" },
      });
      expect(api.status).toBe(401);
      expect(await api.text()).toBe("unauthorized");
      expect((await fetch(`${base}/pfx/x`)).status).toBe(401);

      const fallback = await fetch(`${base}/`, {
        headers: { accept: "text/html", "sec-fetch-dest": "document" },
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

  it("serves only the public read-only static whitelist without credentials", async () => {
    const ctx = new Context();
    const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
    const server = ctx.get("webServer") as unknown as RealServer;
    registerRoutes(server);
    const authFiber = await ctx.plugin({ name, inject, apply, Config }, {} as AuthConfig);
    const port = server.port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 默认 TokenGate（无凭证）：浏览器抓 manifest 时不带 cookie，必须仍可拿 200。
      const manifest = await fetch(`${base}/manifest.webmanifest`);
      expect(manifest.status).toBe(200);
      expect(await manifest.text()).toBe("spa");
      // 只有白名单那一条：相邻静态路径照旧 401。
      expect((await fetch(`${base}/assets/index.js`)).status).toBe(401);
      expect((await fetch(`${base}/manifest.webmanifest.bak`)).status).toBe(401);

      // upgrade 语义不在白名单内（注册出来给守卫拒，仍是 401）。
      server.registerUpgrade({
        path: "/manifest.webmanifest",
        handler: (_req, socket) => {
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
          );
        },
      });
      expect(await requestUpgradeStatus(port, "/manifest.webmanifest")).toBe(401);
    } finally {
      await authFiber.dispose();
      await wsFiber.dispose();
    }
  });
});

/** 另一个宿主插件：在自己的 effect 里注册一条 exact 路由，fiber dispose 时随 effect 注销。 */
function routeOwner(id: string, path: string, body: string) {
  return {
    name: `route-owner-${id}`,
    inject: ["webServer"] as const,
    apply(ctx: Context): void {
      const server = ctx.get("webServer") as unknown as RealServer;
      ctx.effect(
        () =>
          server.register({
            kind: "exact",
            path,
            handler: (_req, res) => {
              res.writeHead(200);
              res.end(body);
            },
          }),
        `route-owner: ${path}`,
      );
    },
  };
}

const authPlugin = { name, inject, apply, Config };
const allowGate: Gate = { decide: () => "allow" };

/** 本插件单独热重载（Plugins 页改配置 = dispose + apply），其余插件不动。 */
async function reloadAuth(ctx: Context, fiber: { dispose(): Promise<unknown> }) {
  await fiber.dispose();
  const next = await ctx.plugin(authPlugin, {} as AuthConfig);
  ctx.get("auth")!.gate = allowGate;
  return next;
}

describe("integration: guard survives a reload of this plugin alone", () => {
  it("keeps a route another plugin registered after the wrap", async () => {
    const ctx = new Context();
    const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(ctx.get("webServer") as unknown as RealServer).port}`;
    let authFiber = await ctx.plugin(authPlugin, {} as AuthConfig);
    ctx.get("auth")!.gate = allowGate;
    const ownerFiber = await ctx.plugin(routeOwner("late", "/owned-late", "late"));

    try {
      expect(await (await fetch(`${base}/owned-late`)).text()).toBe("late");

      authFiber = await reloadAuth(ctx, authFiber);

      const after = await fetch(`${base}/owned-late`);
      expect(after.status).toBe(200);
      expect(await after.text()).toBe("late");
    } finally {
      await ownerFiber.dispose();
      await authFiber.dispose();
      await wsFiber.dispose();
    }
  });

  it("does not resurrect a route its owner disposed while the guard was mounted", async () => {
    const ctx = new Context();
    const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(ctx.get("webServer") as unknown as RealServer).port}`;
    const ownerV1 = await ctx.plugin(routeOwner("early-v1", "/owned-early", "v1"));
    let authFiber = await ctx.plugin(authPlugin, {} as AuthConfig);
    ctx.get("auth")!.gate = allowGate;
    let ownerV2: { dispose(): Promise<unknown> } | undefined;

    try {
      await ownerV1.dispose();
      expect((await fetch(`${base}/owned-early`)).status).toBe(404);

      authFiber = await reloadAuth(ctx, authFiber);
      // 拥有者已卸载：路由不应被 unwrap 的快照写回。
      expect.soft((await fetch(`${base}/owned-early`)).status).toBe(404);

      // 拥有者重新加载：必须拿到新 handler，而不是被复活的旧 handler 占位。
      ownerV2 = await ctx.plugin(routeOwner("early-v2", "/owned-early", "v2"));
      expect(await (await fetch(`${base}/owned-early`)).text()).toBe("v2");
    } finally {
      await ownerV2?.dispose();
      await authFiber.dispose();
      await wsFiber.dispose();
    }
  });
});
