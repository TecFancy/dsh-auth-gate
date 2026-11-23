import { describe, expect, it } from "vitest";
import {
  INDEX_HTML,
  login,
  mountHost,
  RESTRICTED_PASSWORD,
  RESTRICTED_USER,
} from "./integration-host-auth-helpers.js";

/**
 * DSH 0.2.3-alpha.2 的路由级鉴权端到端验收（真 cordis + 真 alpha.2 `WebServer` + 假
 * `connection`，装配在 `integration-host-auth-helpers.ts`）。覆盖这一代最容易静默出错的三条
 * 链路：未登录导航到宿主 `required` 的 `/` 仍被守卫 302 到登录页；登录后 `/` 由宿主经本插件
 * Provider 拿到 Peer 再渲染；`/api` 这类 `required` 路由无会话 401、有会话放行且 handler 收到
 * Peer。bootstrap / 受限会话换不到 Peer，只能走插件自己的 `/auth/*` 页面。
 */
describe("integration: alpha.2 route auth, anonymous surface", () => {
  it("serves the login page unauthenticated and redirects anonymous navigation to it", async () => {
    const host = await mountHost();
    try {
      const page = await fetch(`${host.base}/auth/login`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('name="username"');

      const nav = await fetch(`${host.base}/`, {
        headers: { accept: "text/html", "sec-fetch-dest": "document" },
        redirect: "manual",
      });
      // 宿主把 `/` 声明为 required；适配器降级成 anonymous 后由守卫给出登录跳转。
      expect(nav.status).toBe(302);
      expect(nav.headers.get("location")).toBe("/auth/login?next=%2F");
      expect(nav.headers.get("referrer-policy")).toBe("no-referrer");
      expect(host.traffic.index).toBe(0);

      // 非导航的 API 请求保持 401（fail-closed），不会渲染索引。
      const api = await fetch(`${host.base}/api/session.list`);
      expect(api.status).toBe(401);
      expect(host.traffic.api).toBe(0);
    } finally {
      await host.dispose();
    }
  });
});

describe("integration: alpha.2 route auth, signed-in sessions", () => {
  it("admits the signed-in browser through the host's required routes with a real Peer", async () => {
    const host = await mountHost();
    try {
      const cookie = await login(host.base);

      const index = await fetch(`${host.base}/`, {
        headers: { cookie, accept: "text/html", "sec-fetch-dest": "document" },
        redirect: "manual",
      });
      expect(index.status).toBe(200);
      expect(await index.text()).toBe(INDEX_HTML);
      expect(index.headers.get("x-probe-peer")).toBe("seen");

      const api = await fetch(`${host.base}/api/session.list`, { headers: { cookie } });
      expect(api.status).toBe(200);
      expect(await api.text()).toBe("api ok");
    } finally {
      await host.dispose();
    }
  });

  it("keeps the anonymous /auth surface reachable and still 401s anonymous API", async () => {
    const host = await mountHost();
    try {
      for (const path of ["/auth/login", "/auth/status", "/auth/bootstrap"]) {
        const res = await fetch(`${host.base}${path}`, { redirect: "manual" });
        expect([200, 302]).toContain(res.status);
      }
      const api = await fetch(`${host.base}/api/session.list`);
      expect(api.status).toBe(401);
      expect(await api.text()).not.toBe("api ok");
    } finally {
      await host.dispose();
    }
  });
});

describe("integration: alpha.2 route auth, restricted sessions", () => {
  it("refuses a restricted session on host required routes", async () => {
    const host = await mountHost();
    try {
      const cookie = await login(host.base, RESTRICTED_USER, RESTRICTED_PASSWORD);
      // 受限会话拿不到 Peer：宿主的 `/` 与 `/api` 都拒绝。
      const index = await fetch(`${host.base}/`, {
        headers: { cookie, "sec-fetch-dest": "document" },
        redirect: "manual",
      });
      expect(index.status).toBe(302);
      expect(index.headers.get("location")).toBe("/auth/password");
      expect(host.traffic.index).toBe(0);
      expect((await fetch(`${host.base}/api/session.list`, { headers: { cookie } })).status).toBe(
        401,
      );
    } finally {
      await host.dispose();
    }
  });

  it("keeps the restricted account's own password page reachable", async () => {
    const host = await mountHost();
    try {
      const cookie = await login(host.base, RESTRICTED_USER, RESTRICTED_PASSWORD);
      // 插件自己的改密页仍然可达（`/auth/*` 声明 anonymous，由门放行）。
      const change = await fetch(`${host.base}/auth/password`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(change.status).toBe(200);
    } finally {
      await host.dispose();
    }
  });

  it("refuses a revoked session on host required routes", async () => {
    const host = await mountHost();
    try {
      const cookie = await login(host.base);
      const logout = await fetch(`${host.base}/auth/logout`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: "next=%2F",
        redirect: "manual",
      });
      expect(logout.status).toBe(302);
      const index = await fetch(`${host.base}/`, {
        headers: { cookie, "sec-fetch-dest": "document" },
        redirect: "manual",
      });
      expect(index.status).toBe(302);
      const api = await fetch(`${host.base}/api/session.list`, { headers: { cookie } });
      expect(api.status).toBe(401);
    } finally {
      await host.dispose();
    }
  });
});
