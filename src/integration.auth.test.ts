import { describe, expect, it } from "vitest";
import { mountStack, unmountStack, upgradeRequest } from "./integration-auth-helpers.js";

describe("integration: auth endpoints over real HTTP", () => {
  it("runs the login flow", async () => {
    const { port, token, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const base = `http://127.0.0.1:${port}`;
      const page = await fetch(`${base}/auth/login`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<form");

      const nav = await fetch(`${base}/__probe`, {
        // P2 §3：导航判定只认 Sec-Fetch（Accept 子串匹配已废除）；undici 会改写
        // sec-fetch-mode，故这里用 sec-fetch-dest: document 表达浏览器导航。
        headers: { accept: "text/html", "sec-fetch-dest": "document" },
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
      // D21：真实入口（cordis + webserver + storage）上错 token 也必须拿到卡片，而不是裸文本。
      expect(bad.headers.get("content-type")).toContain("text/html");
      expect(bad.headers.get("cache-control")).toBe("no-store");
      const badBody = await bad.text();
      expect(badBody).toContain('class="error"');
      expect(badBody).toContain("Invalid access token.");
      expect(badBody).not.toContain("wrong"); // 提交的 token 不回显
      expect(badBody).toContain('name="token"');

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

describe("integration: token login bridges the dsh launch token (issue #99)", () => {
  it("redirects to the relative token URL and still issues the session cookie", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "authenticatedUrl",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const bad = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "token=wrong&next=%2F__probe",
      });
      expect(bad.status).toBe(401);
      expect(await bad.text()).not.toContain("launchTok-it");

      const good = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${token}&next=%2F__probe`,
        redirect: "manual",
      });
      expect(good.status).toBe(302);
      // 桥交出的是 dsh 进程的 launch token，不是表单里的共享 token（评审 A8）；
      // 假 authenticatedUrl 带别的 host 与额外 query，桥必须只留 token（D-bridge-1）。
      expect(good.headers.get("location")).toBe("/?token=launchTok-it");
      expect(good.headers.get("location")).not.toContain(token!);
      expect(good.headers.get("referrer-policy")).toBe("no-referrer");
      expect(good.headers.get("set-cookie")).toContain("dsh_auth=");

      const cookie = good.headers.get("set-cookie")!.split(";")[0]!;
      expect((await fetch(`${base}/__probe`, { headers: { cookie } })).status).toBe(200);
      // 第二跳：浏览器带着会话 cookie 跟随 `/?token=`，门必须放行（不再 302 回登录页），
      // 否则 dsh 的 authorizeIndex 根本没机会 mint（issue #99 的实际修复点）。
      const second = await fetch(`${base}/?token=launchTok-it`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(second.headers.get("location")).toBeNull();
      expect(second.status).toBe(200);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("keeps the plain next redirect when dsh registers no connection service at all", async () => {
    const { port, token, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const base = `http://127.0.0.1:${port}`;
      const good = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${token}&next=%2F__probe`,
        redirect: "manual",
      });
      expect(good.status).toBe(302);
      expect(good.headers.get("location")).toBe("/__probe");
      expect(good.headers.get("set-cookie")).toContain("dsh_auth=");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("keeps the plain next redirect when the connection service has no authenticatedUrl", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "bare",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const good = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${token}&next=%2F__probe`,
        redirect: "manual",
      });
      expect(good.status).toBe(302);
      expect(good.headers.get("location")).toBe("/__probe");
      expect(good.headers.get("set-cookie")).toContain("dsh_auth=");
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
