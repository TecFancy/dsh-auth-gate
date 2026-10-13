/**
 * 跨站顶层导航弹回的真实入口测试：真实 cordis + webserver + storage 栈。
 * Sec-Fetch-* 是浏览器保留头，undici fetch 会改写，所以这里用 node:http 直发。
 */
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { mountStack, unmountStack } from "./integration-auth-helpers.js";

interface Raw {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function rawGet(port: number, path: string, headers: Record<string, string>): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request({ port, host: "127.0.0.1", path, method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const nav = (site: string): Record<string, string> => ({
  "sec-fetch-site": site,
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
});

async function login(base: string, token: string | undefined): Promise<string> {
  const good = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `token=${token}&next=%2F`,
    redirect: "manual",
  });
  expect(good.status).toBe(302);
  return good.headers.get("set-cookie")!.split(";")[0]!;
}

describe("integration: cross-site top-level navigation bounce", () => {
  it("bounces an authenticated cross-site navigation, serves the page for same-origin", async () => {
    const { port, token, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);

      const bounce = await rawGet(port, "/", { cookie, ...nav("cross-site") });
      expect(bounce.status).toBe(200);
      expect(bounce.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(bounce.headers["content-security-policy"]).toContain("script-src 'sha256-");
      expect(bounce.body).toContain("location.replace(location.href)");
      expect(bounce.body).not.toContain("index");

      const real = await rawGet(port, "/", { cookie, ...nav("same-origin") });
      expect(real.status).toBe(200);
      expect(real.body).toBe("index");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("bounces /?token=... without reflecting the token", async () => {
    const { port, token, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      const res = await rawGet(port, "/?token=launch-secret-123", {
        cookie,
        ...nav("cross-site"),
      });
      expect(res.status).toBe(200);
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.body).toContain("location.replace(location.href)");
      expect(res.body).not.toContain("launch-secret-123");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("still redirects an unauthenticated cross-site navigation to login", async () => {
    const { port, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const res = await rawGet(port, "/", nav("cross-site"));
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe("/auth/login?next=%2F");
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
