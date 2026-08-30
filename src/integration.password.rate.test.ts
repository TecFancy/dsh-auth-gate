import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";
import { hashPassword } from "./features/password/index.js";
import { writeUsersFile } from "./shared/index.js";

type RealServer = WrappableServer & { readonly port: number };

const TEST_PASSWORD = "s3cret-pw";

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

async function mountPasswordStack(options?: {
  usersFile?: string;
  seedUsers?: boolean;
}): Promise<{ ctx: Context; port: number; fibers: Fiber[]; root: string; usersFile: string }> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-pw-"));
  const usersFile = options?.usersFile ?? join(root, "users.yaml");
  if (options?.seedUsers !== false) {
    const adminHash = await hashPassword(TEST_PASSWORD);
    const disabledHash = await hashPassword(TEST_PASSWORD);
    await writeUsersFile(usersFile, {
      users: new Map([
        ["admin", { passwordHash: adminHash, disabled: false }],
        ["disableduser", { passwordHash: disabledHash, disabled: true }],
      ]),
    });
  }
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
  server.registerUpgrade({
    path: "/events",
    handler: (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
  });
  await waitFor(() => ctx.get("auth")!.sessions !== undefined);
  return { ctx, port: server.port, fibers, root, usersFile };
}

async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

function loginBody(username: string, password: string): string {
  return `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

async function postLogin(
  base: string,
  body: string,
): Promise<{ status: number; cookie: string | undefined; location: string | null }> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    cookie: setCookie?.split(";")[0],
    location: res.headers.get("location"),
  };
}

it("rejects with 401 when the users file is missing (empty store)", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-pw-"));
  const { port, fibers } = await mountPasswordStack({
    usersFile: join(root, "missing", "users.yaml"),
    seedUsers: false,
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const login = await postLogin(base, loginBody("admin", TEST_PASSWORD));
    expect(login.status).toBe(401);
    expect((await fetch(`${base}/__probe`)).status).toBe(401);
  } finally {
    await unmountStack(fibers, root);
  }
});

describe("integration: password rate limiting (isolated instance)", () => {
  it("locks after five failures with 429 + retry-after, blocking even a correct password", async () => {
    const { port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 5; i++) {
        const res = await postLogin(base, loginBody("admin", "wrong"));
        expect(res.status).toBe(401);
      }
      const sixth = await postLogin(base, loginBody("admin", "wrong"));
      expect(sixth.status).toBe(429);
      const locked = await postLogin(base, loginBody("admin", TEST_PASSWORD));
      expect(locked.status).toBe(429);
      const retryAfter = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: loginBody("admin", "wrong"),
        redirect: "manual",
      });
      expect(retryAfter.headers.get("retry-after")).toBe("30");
      expect((await fetch(`${base}/__probe`)).status).toBe(401);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("clears the failure buckets on a successful login (recordSuccess)", async () => {
    const { port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 4; i++) {
        const res = await postLogin(base, loginBody("admin", "wrong"));
        expect(res.status).toBe(401);
      }
      expect((await postLogin(base, loginBody("admin", TEST_PASSWORD))).status).toBe(302);
      // 成功登录已清零失败桶：再失败一次仍为 401，且随后正确口令能登录（未清零则触发 30s 锁 → 429）。
      expect((await postLogin(base, loginBody("admin", "wrong"))).status).toBe(401);
      expect((await postLogin(base, loginBody("admin", TEST_PASSWORD))).status).toBe(302);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: password upgrades", () => {
  it("accepts WS upgrades with a session cookie or bearer session token", async () => {
    const { port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const good = await postLogin(base, loginBody("admin", TEST_PASSWORD));
      const sessionToken = good.cookie!.split("=")[1]!;
      expect(await upgradeRequest(port, { Cookie: `dsh_auth=${sessionToken}` })).toBe("upgrade");
      expect(await upgradeRequest(port, { Authorization: `Bearer ${sessionToken}` })).toBe(
        "upgrade",
      );
      expect(await upgradeRequest(port, {})).toBe(401);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: password session audit", () => {
  it("records the username as the session subject", async () => {
    const { ctx, port, fibers, root } = await mountPasswordStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const good = await postLogin(base, loginBody("admin", TEST_PASSWORD));
      const sessionToken = good.cookie!.split("=")[1]!;
      const store = ctx.get("auth")!.sessions!;
      expect(store.getByToken(sessionToken)?.subject).toBe("admin");
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
