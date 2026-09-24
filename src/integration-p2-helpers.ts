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
import { writeUsersFile } from "./shared/index.js";

/**
 * P2 集成测试夹具：真 `apply()` + 真 HTTP 栈（与 `integration.password.test.ts` 同构）。
 *
 * 关键差异：
 * - users.yaml 里 `admin` 带 `role: "admin"`（P2 管理权限来自**每请求现读**的 yaml）；
 * - `victim` 带 `totpSecret`（用于断言重置不动目标 TOTP 字节）且初始无
 *   `must_change_password` 标记；标记只在 admin 重置后才出现；
 * - `publicHost` 显式配成 `https://dsh.example.test`（带 scheme），这样 Origin 通道
 *   在 http 直连下也可用：Origin 头与实际连接地址无关，正是"运营侧配置不可伪造"的形态。
 */

export const P2_PUBLIC_ORIGIN = "https://dsh.example.test";
// 全部满足 P2 口令策略：≥14 位 + 大写/小写/数字/符号四类（否则管理重置会按策略拒 400）。
export const ADMIN_PASSWORD = "Admin-pw-3cret!";
export const VICTIM_PASSWORD = "Victim-pw-3cret!";
/** admin 重置时给 victim 设的临时口令（重置只改哈希 + 加标记，不代用户选长期口令）。 */
export const VICTIM_RESET_PASSWORD = "Reset-pw-5cret!";
export const VICTIM_NEW_PASSWORD = "New-pw-6cret!aa";
export const VICTIM_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
/** actor（admin）启用 TOTP 时用的 secret（RFC 6238 测试向量那枚）。 */
export const ADMIN_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

/** `POST /auth/users/password` 的表单体（管理重置）。 */
export function resetBody(target: string, password: string): Record<string, string> {
  return { target, password, confirm: password };
}

/** `POST /auth/password` 的表单体（自助改密；`nav=1` = 无 JS 表单）。 */
export function changeBody(current: string, password: string, nav = true): Record<string, string> {
  const body: Record<string, string> = { current, password, confirm: password };
  if (nav) body["nav"] = "1";
  return body;
}

type RealServer = WrappableServer & { readonly port: number };

export interface P2Stack {
  readonly base: string;
  readonly usersFile: string;
  readonly fibers: Fiber[];
  readonly root: string;
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 隔离的用户库：一个 admin（角色来自 yaml，每请求现读）+ 一个带 TOTP secret 的 victim。 */
async function seedUsersFile(usersFile: string, adminTotpSecret?: string): Promise<void> {
  await writeUsersFile(usersFile, {
    users: new Map([
      [
        "admin",
        {
          passwordHash: await hashPassword(ADMIN_PASSWORD),
          disabled: false,
          role: "admin",
          ...(adminTotpSecret === undefined ? {} : { totpSecret: adminTotpSecret }),
        },
      ],
      [
        "victim",
        {
          passwordHash: await hashPassword(VICTIM_PASSWORD),
          disabled: false,
          role: "user",
          totpSecret: VICTIM_TOTP_SECRET,
        },
      ],
    ]),
  });
}

export interface MountP2Options {
  /** 给 actor（admin）启用 TOTP：用于"同码不能在两处各用一次"的真栈用例。 */
  readonly adminTotpSecret?: string | undefined;
}

export async function mountP2Stack(options: MountP2Options = {}): Promise<P2Stack> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-p2-"));
  const usersFile = join(root, "users.yaml");
  await seedUsersFile(usersFile, options.adminTotpSecret);
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
      publicHost: P2_PUBLIC_ORIGIN,
      // 关掉周期扫描：本夹具不涉及禁用用户，避免后台文件 IO 干扰断言时序。
      revokeSweepMs: 0,
      // 缺省 totp: off ⇒ 带 secret 的 victim 仍走纯密码登录（secret 只作为"字节不动"的靶子）；
      // 需要"同码不能在两处各用一次"的用例时才为 actor 打开 TOTP。
      totp: options.adminTotpSecret === undefined ? "off" : "optional",
      // 可信反代：直连 peer 是回环，因此 `x-forwarded-for` 可用来模拟不同客户端 IP
      // （限流桶按 IP + 账号双桶，必须能把"账号桶已清"与"IP 桶仍锁"分开断言）。
      clientIpHeader: "x-forwarded-for",
      trustedProxyCidrs: ["127.0.0.0/8", "::1/128"],
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
  // `/api` 面必须**真实注册**才会经过守卫包装：未注册路径由 webserver 直接 404，
  // 根本走不到门（那样断言 401 是假绿/假红）。
  server.register({
    kind: "exact",
    path: "/api/__probe",
    handler: (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
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
  return { base: `http://127.0.0.1:${server.port}`, usersFile, fibers, root };
}

export async function unmountP2Stack(stack: P2Stack): Promise<void> {
  for (const fiber of [...stack.fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(stack.root, { recursive: true, force: true });
}

export interface Res {
  readonly status: number;
  readonly body: string;
  readonly location: string | null;
  readonly cookie: string | undefined;
  /** 全部 set-cookie 的 `名=值`（TOTP 两段式登录需要同时取挑战 cookie 与会话 cookie）。 */
  readonly cookies: string[];
  readonly allow: string | null;
}

async function call(
  base: string,
  path: string,
  init: RequestInit & { cookie?: string | undefined; forwardedFor?: string | undefined },
): Promise<Res> {
  const headers = new Headers(init.headers);
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  if (init.forwardedFor !== undefined) headers.set("x-forwarded-for", init.forwardedFor);
  const res = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  const rawCookies = res.headers.getSetCookie();
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get("location"),
    cookie: rawCookies[0]?.split(";")[0],
    cookies: rawCookies.map((value) => value.split(";")[0] ?? ""),
    allow: res.headers.get("allow"),
  };
}

/** 取指定名的 cookie 对（`名=值`），供后续请求头复用。 */
export function cookiePair(res: Res, name: string): string | undefined {
  return res.cookies.find((value) => value.startsWith(`${name}=`));
}

export function loginBody(username: string, password: string, next?: string): string {
  const body = new URLSearchParams({ username, password }).toString();
  return next === undefined ? body : `${body}&next=${encodeURIComponent(next)}`;
}

export function postLogin(
  base: string,
  body: string,
  options: { cookie?: string | undefined; forwardedFor?: string | undefined } = {},
): Promise<Res> {
  return call(base, "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cookie: options.cookie,
    forwardedFor: options.forwardedFor,
  });
}

/** 已认证写请求：默认带上「运营侧配置的对外来源」，即 Origin 通道的正例。 */
export function postForm(
  base: string,
  path: string,
  body: Record<string, string>,
  options: {
    cookie?: string | undefined;
    origin?: string | null | undefined;
    secFetchSite?: string | undefined;
    forwardedFor?: string | undefined;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (options.origin !== null) headers["origin"] = options.origin ?? P2_PUBLIC_ORIGIN;
  if (options.secFetchSite !== undefined) headers["sec-fetch-site"] = options.secFetchSite;
  return call(base, path, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
    cookie: options.cookie,
    forwardedFor: options.forwardedFor,
  });
}

export function get(
  base: string,
  path: string,
  options: {
    cookie?: string | undefined;
    origin?: string | undefined;
    secFetchMode?: string | undefined;
    secFetchDest?: string | undefined;
    forwardedFor?: string | undefined;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (options.origin !== undefined) headers["origin"] = options.origin;
  if (options.secFetchMode !== undefined) headers["sec-fetch-mode"] = options.secFetchMode;
  if (options.secFetchDest !== undefined) headers["sec-fetch-dest"] = options.secFetchDest;
  return call(base, path, {
    method: "GET",
    headers,
    cookie: options.cookie,
    forwardedFor: options.forwardedFor,
  });
}

/** 取 `session.kind` 现读值（集成断言用；不经过 HTTP 面）。 */
export function sessionKindOf(cookie: string, store: { getByToken(t: string): unknown }): string {
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const session = store.getByToken(token) as { kind?: string } | undefined;
  return session?.kind ?? "full";
}
