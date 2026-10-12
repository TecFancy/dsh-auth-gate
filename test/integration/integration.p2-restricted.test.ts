import { request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import {
  ADMIN_PASSWORD,
  VICTIM_NEW_PASSWORD,
  VICTIM_RESET_PASSWORD,
  changeBody,
  get,
  loginBody,
  mountP2Stack,
  postForm,
  postLogin,
  resetBody,
  unmountP2Stack,
  type P2Stack,
} from "./integration-p2-helpers.js";

/** 受限会话（登录门）契约 §8-C：允许集、SSR 改密页、改密后闭环。 */

async function withStack(scenario: (stack: P2Stack) => Promise<void>): Promise<void> {
  const stack = await mountP2Stack();
  try {
    await scenario(stack);
  } finally {
    await unmountP2Stack(stack);
  }
}

async function restrictedVictim(stack: P2Stack): Promise<string> {
  const admin = await postLogin(stack.base, loginBody("admin", ADMIN_PASSWORD));
  await postForm(stack.base, "/auth/users/password", resetBody("victim", VICTIM_RESET_PASSWORD), {
    cookie: admin.cookie,
  });
  const res = await postLogin(stack.base, loginBody("victim", VICTIM_RESET_PASSWORD));
  if (res.status !== 302 || res.cookie === undefined) {
    throw new Error(`restricted login failed: ${res.status}`);
  }
  return res.cookie;
}

async function statusOf(stack: P2Stack, cookie: string): Promise<Record<string, unknown>> {
  const res = await get(stack.base, "/auth/status", { cookie });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as Record<string, unknown>;
}

/** WS 升级探针：拿到 101/401 之类 HTTP 响应返回状态码，纯拒握手（直接断连）返回 0。 */
function upgradeProbe(base: string, path: string, cookie: string): Promise<number> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: url.hostname,
      port: url.port,
      path,
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        cookie,
      },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("upgrade", () => resolve(101));
    req.on("close", () => resolve(0));
    req.on("error", reject);
    req.end();
  });
}

async function scenarioConfinement(stack: P2Stack): Promise<void> {
  const admin = await postLogin(stack.base, loginBody("admin", ADMIN_PASSWORD));
  await postForm(stack.base, "/auth/users/password", resetBody("victim", VICTIM_RESET_PASSWORD), {
    cookie: admin.cookie,
  });

  const login = await postLogin(stack.base, loginBody("victim", VICTIM_RESET_PASSWORD, "/__probe"));
  expect(login.status).toBe(302);
  // 有标记的登录忽略 next：不把用户送回宿主。
  expect(login.location).toBe("/auth/password");
  const cookie = login.cookie!;

  const status = await statusOf(stack, cookie);
  expect(status).toMatchObject({
    authenticated: true,
    name: "victim",
    sessionKind: "password-change-only",
    mustChangePassword: true,
  });

  // 浏览器导航被挡回改密页；API 面 401；WS 拒握手。
  const nav = await get(stack.base, "/__probe", {
    cookie,
    secFetchMode: "navigate",
    secFetchDest: "document",
  });
  expect(nav.status).toBe(302);
  expect(nav.location).toBe("/auth/password");
  expect((await get(stack.base, "/__probe", { cookie })).status).toBe(401);
  expect((await get(stack.base, "/api/__probe", { cookie })).status).toBe(401);
  // 拒握手：既不能 101，也不能握手成功后由原 handler 应答（0 = 协商前被断开）。
  expect([0, 401]).toContain(await upgradeProbe(stack.base, "/events", cookie));

  // 受限会话不能进管理面（handler 403，不是 gate 302）。
  expect((await get(stack.base, "/auth/users", { cookie })).status).toBe(403);
  // 换人必须先登出；受限 cookie 上不许再登录（带 cookie 的 POST 才是这条语义）。
  const reLogin = await postLogin(stack.base, loginBody("victim", VICTIM_RESET_PASSWORD), {
    cookie,
  });
  expect(reLogin.status).toBe(403);
  expect((await get(stack.base, "/auth/login", { cookie })).status).toBe(302);
}

async function scenarioSsrPage(stack: P2Stack): Promise<void> {
  const anon = await get(stack.base, "/auth/password");
  expect(anon.status).toBe(302);
  expect(anon.location).toBe("/auth/login?next=/auth/password");

  const cookie = await restrictedVictim(stack);
  const page = await get(stack.base, "/auth/password", { cookie });
  expect(page.status).toBe(200);
  expect(page.body).toContain('name="current"');
  expect(page.body).toContain('name="password"');
  expect(page.body).toContain('name="confirm"');
  expect(page.body).toContain('name="nav"');
  expect(page.body).toContain('autocomplete="new-password"');
  // 自足性：零外链、无脚本（受限会话进不了宿主 UI，页面必须自己能跑）。
  // 白名单式扫描不够：内联 CSS 的 @import/url()、iframe、formaction 也能把页面拉去外部。
  expect(page.body).not.toContain("<script");
  expect(page.body).not.toMatch(/(href|src|formaction)="(https?:)?\/\//);
  expect(page.body).not.toContain("/plugins/");
  expect(page.body).not.toContain("@import");
  expect(page.body).not.toMatch(/url\(/i);
  expect(page.body).not.toContain("<iframe");

  const postWithoutBody = await postForm(stack.base, "/auth/password", {}, { cookie });
  expect(postWithoutBody.status).toBeGreaterThanOrEqual(400);
}

async function scenarioChangeLoop(stack: P2Stack): Promise<void> {
  const cookie = await restrictedVictim(stack);

  const changed = await postForm(
    stack.base,
    "/auth/password",
    changeBody(VICTIM_RESET_PASSWORD, VICTIM_NEW_PASSWORD),
    { cookie },
  );
  expect(changed.status).toBe(302);
  expect(changed.location).toBe("/auth/login?notice=password-changed");

  // 旧 cookie（含受限会话本身）立即失效，且绝不升级成 full。
  expect((await get(stack.base, "/__probe", { cookie })).status).toBe(401);

  const relogin = await postLogin(stack.base, loginBody("victim", VICTIM_NEW_PASSWORD));
  expect(relogin.status).toBe(302);
  expect(relogin.location).toBe("/");
  const full = await statusOf(stack, relogin.cookie!);
  expect(full).toMatchObject({ sessionKind: "full", mustChangePassword: false });
  expect((await get(stack.base, "/__probe", { cookie: relogin.cookie })).status).toBe(200);
}

async function scenarioSelfServiceGuards(stack: P2Stack): Promise<void> {
  const cookie = await restrictedVictim(stack);

  const missingCurrent = await postForm(
    stack.base,
    "/auth/password",
    { password: VICTIM_NEW_PASSWORD, confirm: VICTIM_NEW_PASSWORD, nav: "1" },
    { cookie },
  );
  expect(missingCurrent.status).toBeGreaterThanOrEqual(400);
  const wrongCurrent = await postForm(
    stack.base,
    "/auth/password",
    changeBody("not-the-current-one", VICTIM_NEW_PASSWORD),
    { cookie },
  );
  expect(wrongCurrent.status).toBeGreaterThanOrEqual(400);

  // 仍是受限会话，标记未被清（本设计的隐式提权边界）。
  const status = await statusOf(stack, cookie);
  expect(status).toMatchObject({
    sessionKind: "password-change-only",
    mustChangePassword: true,
  });

  const noOrigin = await postForm(
    stack.base,
    "/auth/password",
    changeBody(VICTIM_RESET_PASSWORD, VICTIM_NEW_PASSWORD),
    { cookie, origin: null },
  );
  expect(noOrigin.status).toBe(403);

  // ★#29：受限会话的自助改密仍计入 P1 桶，不因"已登录"豁免（用独立客户端 IP 打阶梯）。
  const ladder: number[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await postForm(
      stack.base,
      "/auth/password",
      changeBody("still-wrong-1A!", VICTIM_NEW_PASSWORD),
      { cookie, forwardedFor: "10.0.0.21" },
    );
    ladder.push(res.status);
  }
  expect(ladder).toContain(429);
  // 桶互相独立：登录桶没被带锁，用户仍能用正确口令登录。
  const stillLogsIn = await postLogin(stack.base, loginBody("victim", VICTIM_RESET_PASSWORD), {
    forwardedFor: "10.0.0.21",
  });
  expect(stillLogsIn.status).toBe(302);
}

/**
 * 路径形状（grok 实现期复审 G2）：dot-segment 归一只发生一次，且在**路由之前**
 * （真 dsh WebServer 与 gate 看同一条路径），所以没有「gate 与 handler 分歧」可利用；
 * 编码斜杠（`%2f`）不参与归一化，既进不了 `/auth/*`，也不匹配任何路由。
 */
async function scenarioPathShapes(stack: P2Stack): Promise<void> {
  const cookie = await restrictedVictim(stack);

  // `/api/../auth/status` 与 `/api/%2e%2e/auth/status` 都归一到 `/auth/status`
  // （受限会话允许集内），证明归一化对 gate 与 router 一致。
  expect((await get(stack.base, "/api/%2e%2e/auth/status", { cookie })).status).toBe(200);
  expect((await get(stack.base, "/api/../auth/status", { cookie })).status).toBe(200);

  // 宿主面不能靠 dot-segment 形状绕开（两条都归一到 `/api/__probe` → 401）。
  expect((await get(stack.base, "/api/%2e%2e/api/__probe", { cookie })).status).toBe(401);
  expect((await get(stack.base, "/auth/%2e%2e/api/__probe", { cookie })).status).toBe(401);

  // 归一到管理面 exact 路径：进 handler 后仍按受限会话 403（不是 gate 302）。
  expect((await get(stack.base, "/auth/users/%2e%2e/users", { cookie })).status).toBe(403);

  // 编码斜杠不解码：归一化结果既不在允许集内也不匹配任何路由（webserver 直接 404，
  // 见 integration-p2-helpers 的说明），绝不放行。
  const encodedSlash = await get(stack.base, "/api/%2e%2e%2fauth%2fstatus", { cookie });
  expect([401, 404]).toContain(encodedSlash.status);
  const navEncoded = await get(stack.base, "/auth/%2e%2e/plugins/x", {
    cookie,
    secFetchMode: "navigate",
    secFetchDest: "document",
  });
  expect([302, 404]).toContain(navEncoded.status);
  if (navEncoded.status === 302) expect(navEncoded.location).toBe("/auth/password");
}

/**
 * 第二个 Location 出口（grok 实现期复审 G3）：`POST /auth/logout?next=` 把 `next`
 * 直接写进 Location（`src/http/endpoints.ts` 的 logout），同一消毒判定必须同时覆盖它。
 */
async function scenarioLogoutLocation(stack: P2Stack): Promise<void> {
  const cookie = await restrictedVictim(stack);
  const res = await postForm(stack.base, "/auth/logout?next=%2F%09%2Fevil.com", {}, { cookie });
  expect(res.status).toBe(302);
  expect(res.location).toBe("/");
}

describe("integration P2: restricted session (login gate)", () => {
  it("issues a restricted session that ignores next and is confined to the auth surface", () =>
    withStack(scenarioConfinement));
  it("serves a self-sufficient SSR form and distinguishes unauthenticated visits", () =>
    withStack(scenarioSsrPage));

  it("closes the loop: nav=1 submit clears the marker, kills old cookies, and re-login is full", () =>
    withStack(scenarioChangeLoop));

  it("requires the current password and a valid origin on the self-service submit", () =>
    withStack(scenarioSelfServiceGuards));

  it("normalizes dot segments once, before routing and the gate, with no handler divergence", () =>
    withStack(scenarioPathShapes));

  it("sanitizes the logout Location sink with the same control-character rule", () =>
    withStack(scenarioLogoutLocation));
});
