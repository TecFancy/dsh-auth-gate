import { describe, expect, it } from "vitest";
import { loadUsersFile } from "../../src/host/entities/user/index.js";
import {
  bootstrapCookie,
  FORM,
  LAUNCH,
  NAVIGATION,
  sessionCookie,
  withStack,
} from "./integration-bootstrap-helpers.js";

/**
 * issue #115 首次引导通道的真栈集成测试：真 cordis + 真 webserver + 真 storage，
 * 只有 dsh 的 connection 与 credentials 是假的（测试里可写）。
 *
 * 状态机逐条覆盖（设计 §3）：门只按形状重定向 → 引导端点校验 launch token 并签发
 * bootstrap 会话 → 向导页 → 提交后关窗并签发正式会话 → `/auth/continue` 回到 dsh。
 */

/** 新装实例：没有配置，但凭据服务已经在位（解析为空 = 真未配置）。 */
const FRESH = {
  withCredentials: false,
  writableCredentials: true,
  connection: "authenticatedUrl",
} as const;
/** 连凭据服务都没有：探针只能给 unknown，引导窗口必须关着。 */
const NO_CREDENTIALS = { withCredentials: false, connection: "authenticatedUrl" } as const;

describe("integration: launch URL enters the bootstrap channel", () => {
  it("1. sends a fresh token-mode instance to the bootstrap endpoint", async () => {
    await withStack(FRESH, async (_stack, base) => {
      const res = await fetch(`${base}/?token=${LAUNCH}`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/auth/bootstrap?token=${LAUNCH}`);
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  it("2. issues a bootstrap session and redirects to the wizard", async () => {
    await withStack(FRESH, async (_stack, base) => {
      const res = await fetch(`${base}/auth/bootstrap?token=${LAUNCH}`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/auth/setup");
      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toContain("dsh_auth=");
      expect(setCookie).toContain("Max-Age=3600");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(res.headers.get("cache-control")).toBe("no-store");
      // 响应头与响应体都不带 launch token。
      expect(JSON.stringify([...res.headers])).not.toContain(LAUNCH);
      expect(await res.text()).not.toContain(LAUNCH);
    });
  });
});

describe("integration: wizard page", () => {
  it("3. requires the bootstrap session", async () => {
    await withStack(FRESH, async (_stack, base) => {
      const anonymous = await fetch(`${base}/auth/setup`, { redirect: "manual" });
      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get("location")).toBe("/auth/login?next=%2F");

      const cookie = await bootstrapCookie(base);
      const page = await fetch(`${base}/auth/setup`, { headers: { cookie } });
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-store");
      const html = await page.text();
      expect(html).toContain("First run");
      expect(html).toContain("Generate access token");
      expect(html).not.toContain(LAUNCH);
    });
  });
});

describe("integration: token-mode setup", () => {
  const WRITABLE = { ...FRESH, writableCredentials: true, publicHost: "dsh.example.com" } as const;
  const POST_HEADERS = {
    "content-type": FORM,
    origin: "http://dsh.example.com",
  };

  it("4. writes the credential, closes the window and reaches dsh", async () => {
    await withStack(WRITABLE, async (stack, base) => {
      const cookie = await bootstrapCookie(base);
      const post = await fetch(`${base}/auth/setup`, {
        method: "POST",
        headers: { ...POST_HEADERS, cookie },
        body: "",
        redirect: "manual",
      });
      expect(post.status).toBe(200);
      const written = stack.credentialsStore?.get("DSH_AUTH_TOKEN");
      expect(written).toBeTruthy();
      const body = await post.text();
      // 新令牌只出现一次，且页面不被缓存。
      expect(body.split(written!).length - 1).toBe(1);
      expect(post.headers.get("cache-control")).toBe("no-store");

      // 关窗：旧 launch URL 不再能换 bootstrap 会话，也不再下发 cookie。
      const hop = await fetch(`${base}/?token=${LAUNCH}`, { redirect: "manual" });
      expect(hop.headers.get("location")).toBe(`/auth/bootstrap?token=${LAUNCH}`);
      const closed = await fetch(`${base}${hop.headers.get("location")!}`, { redirect: "manual" });
      expect(closed.status).toBe(302);
      expect(closed.headers.get("location")).toBe("/auth/login?next=%2F");
      expect(closed.headers.get("set-cookie")).toBeNull();

      // 正式会话把浏览器送回 dsh 的 launch URL。
      const cont = await fetch(`${base}/auth/continue`, {
        headers: { cookie: sessionCookie(post) },
        redirect: "manual",
      });
      expect(cont.status).toBe(302);
      expect(cont.headers.get("location")).toBe(`/?token=${LAUNCH}`);
      expect(cont.headers.get("cache-control")).toBe("no-store");
    });
  });
});

describe("integration: password-mode setup", () => {
  it("5. creates the first admin and closes the window", async () => {
    await withStack(
      { ...FRESH, mode: "password", publicHost: "dsh.example.com" },
      async (stack, base) => {
        const cookie = await bootstrapCookie(base);
        const page = await fetch(`${base}/auth/setup`, { headers: { cookie } });
        expect(await page.text()).toContain('name="username"');

        const post = await fetch(`${base}/auth/setup`, {
          method: "POST",
          headers: {
            cookie,
            "content-type": FORM,
            origin: "http://dsh.example.com",
          },
          body: new URLSearchParams({
            username: "root",
            password: "Sup3r-secret-pw",
            confirm: "Sup3r-secret-pw",
          }).toString(),
          redirect: "manual",
        });
        expect(post.status).toBe(302);
        expect(post.headers.get("location")).toBe("/auth/continue");

        const loaded = await loadUsersFile(stack.usersFile);
        expect(loaded.missing).toBe(false);
        expect(loaded.snapshot.users.get("root")?.role).toBe("admin");

        const closed = await fetch(`${base}/auth/bootstrap?token=${LAUNCH}`, {
          redirect: "manual",
        });
        expect(closed.headers.get("location")).toBe("/auth/login?next=%2F");
        expect(closed.headers.get("set-cookie")).toBeNull();

        const cont = await fetch(`${base}/auth/continue`, {
          headers: { cookie: sessionCookie(post) },
          redirect: "manual",
        });
        expect(cont.headers.get("location")).toBe(`/?token=${LAUNCH}`);
      },
    );
  });
});

describe("integration: no bootstrap window when it must not open", () => {
  it("6. never bootstraps an already configured instance", async () => {
    await withStack(
      { withCredentials: true, connection: "authenticatedUrl" },
      async (stack, base) => {
        const hop = await fetch(`${base}/?token=${stack.token}`, { redirect: "manual" });
        expect(hop.headers.get("location")).toBe(`/auth/bootstrap?token=${stack.token}`);
        const endpoint = await fetch(`${base}${hop.headers.get("location")!}`, {
          redirect: "manual",
        });
        expect(endpoint.status).toBe(302);
        expect(endpoint.headers.get("location")).toBe("/auth/login?next=%2F");
        expect(endpoint.headers.get("set-cookie")).toBeNull();
      },
    );
  });

  it("7. keeps today's deny on an old dsh without connection.authenticatedUrl", async () => {
    await withStack({ ...NO_CREDENTIALS, connection: "bare" }, async (_stack, base) => {
      const endpoint = await fetch(`${base}/auth/bootstrap?token=${LAUNCH}`, {
        redirect: "manual",
      });
      expect(endpoint.status).toBe(302);
      expect(endpoint.headers.get("location")).toBe("/auth/login?next=%2F");
      expect(endpoint.headers.get("set-cookie")).toBeNull();
      // 未认证的数据面行为不变。
      expect((await fetch(`${base}/__probe`)).status).toBe(401);
    });
  });
});

describe("integration: bootstrap session hardening", () => {
  it("8. keeps a bootstrap session inside /auth", async () => {
    await withStack(FRESH, async (_stack, base) => {
      const cookie = await bootstrapCookie(base);
      const nav = await fetch(`${base}/`, {
        headers: { cookie, ...NAVIGATION },
        redirect: "manual",
      });
      expect(nav.status).toBe(302);
      expect(nav.headers.get("location")).toBe("/auth/setup");
      expect(nav.headers.get("referrer-policy")).toBe("no-referrer");
      expect((await fetch(`${base}/__probe`, { headers: { cookie } })).status).toBe(401);
      expect((await fetch(`${base}/auth/setup`, { headers: { cookie } })).status).toBe(200);
    });
  });

  it("9. leaks no Set-Cookie on any failure path", async () => {
    await withStack(
      { ...FRESH, writableCredentials: true, publicHost: "dsh.example.com" },
      async (_stack, base) => {
        const paths = [
          "/auth/bootstrap?token=wrong",
          "/auth/bootstrap",
          `/auth/bootstrap?token=${LAUNCH}&token=${LAUNCH}`,
          "/auth/bootstrap?token=%20",
        ];
        for (const path of paths) {
          const res = await fetch(`${base}${path}`, { redirect: "manual" });
          expect(res.status).toBe(302);
          expect(res.headers.get("location")).toBe("/auth/login?next=%2F");
          expect(res.headers.get("set-cookie")).toBeNull();
        }

        const cookie = await bootstrapCookie(base);
        const untrusted = await fetch(`${base}/auth/setup`, {
          method: "POST",
          headers: { cookie, "content-type": FORM },
          body: "",
          redirect: "manual",
        });
        expect(untrusted.status).toBe(403);
        expect(untrusted.headers.get("set-cookie")).toBeNull();
        expect(await untrusted.text()).toBe("untrusted origin");
      },
    );
  });
});
