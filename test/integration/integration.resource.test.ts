import { Context } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { describe, expect, it } from "vitest";
import type { Gate, WrappableServer } from "../../src/host/shared/guard/index.js";
import { apply, Config, inject, name, type AuthConfig } from "../../src/index.js";

/**
 * 真实 Cordis + WebServer 栈上的 resource 路由验收。DSH 0.2.2 起
 * `webServer.register` / `registerFallback` 接受 Fetch 形态的 `{ resource }`，
 * 官方 `/plugins` 前缀与 SPA 兜底就是这种形态；这里用同一形态的探针路由覆盖
 * 「存量 + 晚注册 + fallback + 卸载还原」四件事，避免只在 fake server 上自证。
 */
type RealServer = WrappableServer & { readonly port: number };

const BUNDLE = "export const x = 1;\n";

function reply(body: string, init: ResponseInit = {}): Promise<Response> {
  return Promise.resolve(new Response(body, init));
}

function registerResourceRoutes(server: RealServer): void {
  server.register({
    kind: "prefix",
    path: "/plugins",
    resource: (request) =>
      reply(BUNDLE, {
        status: 200,
        headers: {
          "content-type": "text/javascript",
          "x-probe-path": new URL(request.url).pathname,
        },
      }),
  });
  server.registerFallback({
    resource: () =>
      reply("<html>spa</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });
}

interface MountedHost {
  ctx: Context;
  server: RealServer;
  base: string;
  dispose: () => Promise<void>;
}

async function mountHost(): Promise<MountedHost> {
  const ctx = new Context();
  const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
  const server = ctx.get("webServer") as unknown as RealServer;
  registerResourceRoutes(server);
  const authFiber = await ctx.plugin({ name, inject, apply, Config }, {} as AuthConfig);
  return {
    ctx,
    server,
    base: `http://127.0.0.1:${server.port}`,
    dispose: async () => {
      await authFiber.dispose();
      await wsFiber.dispose();
    },
  };
}

const denyGate: Gate = { decide: () => "deny" };
const allowGate: Gate = { decide: () => "allow" };

describe("integration: real webserver + guard on resource routes", () => {
  it("denies unauthenticated resource prefix and fallback over real HTTP", async () => {
    const host = await mountHost();
    try {
      host.ctx.get("auth")!.gate = denyGate;
      expect((await fetch(`${host.base}/plugins/app.js`)).status).toBe(401);
      expect((await fetch(`${host.base}/`)).status).toBe(401);
    } finally {
      await host.dispose();
    }
  });

  it("redirects resource navigation denials to the login page", async () => {
    const host = await mountHost();
    try {
      host.ctx.get("auth")!.gate = denyGate;
      // undici 会把 sec-fetch-mode 强制改写成 cors，导航标记只能用 sec-fetch-dest。
      const nav = await fetch(`${host.base}/plugins/app.js`, {
        headers: { accept: "text/html", "sec-fetch-dest": "document" },
        redirect: "manual",
      });
      expect(nav.status).toBe(302);
      expect(nav.headers.get("location")).toBe("/auth/login?next=%2Fplugins%2Fapp.js");
      expect(nav.headers.get("referrer-policy")).toBe("no-referrer");

      const spaNav = await fetch(`${host.base}/some/deep/link`, {
        headers: { accept: "text/html", "sec-fetch-dest": "document" },
        redirect: "manual",
      });
      expect(spaNav.status).toBe(302);
      expect(spaNav.headers.get("location")).toBe("/auth/login?next=%2Fsome%2Fdeep%2Flink");
    } finally {
      await host.dispose();
    }
  });

  it("guards a resource route registered after the plugin applies", async () => {
    const host = await mountHost();
    try {
      host.ctx.get("auth")!.gate = denyGate;
      host.server.register({
        kind: "prefix",
        path: "/late",
        resource: () => reply("late"),
      });
      expect((await fetch(`${host.base}/late/x`)).status).toBe(401);
    } finally {
      await host.dispose();
    }
  });
});

describe("integration: real webserver + guard on resource routes (allow paths)", () => {
  it("allows authenticated resource responses without changing headers or body", async () => {
    const host = await mountHost();
    try {
      host.ctx.get("auth")!.gate = allowGate;
      const bundle = await fetch(`${host.base}/plugins/app.js`);
      expect(bundle.status).toBe(200);
      expect(bundle.headers.get("content-type")).toBe("text/javascript");
      expect(bundle.headers.get("x-probe-path")).toBe("/plugins/app.js");
      expect(await bundle.text()).toBe(BUNDLE);

      const spa = await fetch(`${host.base}/deep/link`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toBe("<html>spa</html>");
    } finally {
      await host.dispose();
    }
  });

  it("serves only the public static whitelist through a resource fallback", async () => {
    const host = await mountHost();
    try {
      // 默认 TokenGate：manifest 白名单在门里判定，守卫只负责让 fallback 也过门。
      expect((await fetch(`${host.base}/manifest.webmanifest`)).status).toBe(200);
      expect((await fetch(`${host.base}/manifest.webmanifest.bak`)).status).toBe(401);
    } finally {
      await host.dispose();
    }
  });

  it("bounces authenticated cross-site resource navigation back same-origin", async () => {
    const host = await mountHost();
    try {
      host.ctx.get("auth")!.gate = allowGate;
      const bounced = await fetch(`${host.base}/deep/link?token=secret`, {
        headers: { "sec-fetch-site": "cross-site", "sec-fetch-dest": "document" },
      });
      expect(bounced.status).toBe(200);
      expect(bounced.headers.get("content-security-policy")).toContain("script-src 'sha256-");
      const html = await bounced.text();
      expect(html).toContain("location.replace");
      expect(html).not.toContain("secret");
    } finally {
      await host.dispose();
    }
  });

  it("restores the original resource entries when the plugin disposes", async () => {
    const ctx = new Context();
    const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
    const server = ctx.get("webServer") as unknown as RealServer;
    registerResourceRoutes(server);
    const authFiber = await ctx.plugin({ name, inject, apply, Config }, {} as AuthConfig);
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect((await fetch(`${base}/plugins/app.js`)).status).toBe(401);
      await authFiber.dispose();
      expect((await fetch(`${base}/plugins/app.js`)).status).toBe(200);
      expect((await fetch(`${base}/manifest.webmanifest`)).status).toBe(200);
    } finally {
      await wsFiber.dispose();
    }
  });
});
