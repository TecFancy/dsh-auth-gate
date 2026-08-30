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
import { describe, expect, it } from "vitest";
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";

type RealServer = WrappableServer & { readonly port: number };

function upgradeRequest(
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

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function mountStack(options: { withCredentials: boolean }): Promise<{
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

async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

describe("integration: auth endpoints over real HTTP", () => {
  it("runs the login flow", async () => {
    const { port, token, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const base = `http://127.0.0.1:${port}`;
      const page = await fetch(`${base}/auth/login`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<form");

      const nav = await fetch(`${base}/__probe`, {
        headers: { accept: "text/html" },
        redirect: "manual",
      });
      expect(nav.status).toBe(302);
      expect(nav.headers.get("location")).toBe("/auth/login?next=%2F__probe");
      expect((await fetch(`${base}/__probe`)).status).toBe(401);

      const bad = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "token=wrong",
      });
      expect(bad.status).toBe(401);

      const good = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${token}&next=%2F__probe`,
        redirect: "manual",
      });
      expect(good.status).toBe(302);
      expect(good.headers.get("location")).toBe("/__probe");
      const cookie = good.headers.get("set-cookie")!.split(";")[0]!;

      expect((await fetch(`${base}/__probe`, { headers: { cookie } })).status).toBe(200);
      const status = await fetch(`${base}/auth/status`, { headers: { cookie } });
      expect(await status.text()).toBe('{"authenticated":true,"logoutOrder":1000}');
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: token gate over real HTTP", () => {
  it("honors bearer, WS upgrades and logout", async () => {
    const { port, token, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const base = `http://127.0.0.1:${port}`;
      const good = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${token}`,
        redirect: "manual",
      });
      const cookie = good.headers.get("set-cookie")!.split(";")[0]!;

      expect(
        (await fetch(`${base}/__probe`, { headers: { authorization: `Bearer ${token}` } })).status,
      ).toBe(200);
      expect(
        (await fetch(`${base}/__probe`, { headers: { authorization: "Bearer wrong" } })).status,
      ).toBe(401);

      expect(await upgradeRequest(port, { Cookie: cookie })).toBe("upgrade");
      expect(await upgradeRequest(port, { Authorization: `Bearer ${token}` })).toBe("upgrade");
      expect(await upgradeRequest(port, {})).toBe(401);

      const logout = await fetch(`${base}/auth/logout?next=/`, {
        method: "POST",
        headers: { cookie },
        redirect: "manual",
      });
      expect(logout.status).toBe(302);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      expect((await fetch(`${base}/__probe`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("answers /auth/* fallback paths with 404 and rejects wrong methods with 405", async () => {
    const { port, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const base = `http://127.0.0.1:${port}`;
      expect((await fetch(`${base}/auth/whatever`)).status).toBe(404);
      const del = await fetch(`${base}/auth/login`, { method: "DELETE" });
      expect(del.status).toBe(405);
      expect(del.headers.get("allow")).toBe("GET, POST");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("rejects login when the credentials service is missing (fail-closed)", async () => {
    const { port, fibers, root } = await mountStack({ withCredentials: false });
    try {
      const base = `http://127.0.0.1:${port}`;
      const login = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "token=anything",
      });
      expect(login.status).toBe(401);
      expect((await fetch(`${base}/__probe`)).status).toBe(401);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
