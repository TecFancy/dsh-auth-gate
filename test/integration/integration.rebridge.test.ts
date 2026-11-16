/**
 * 放行后重铸宿主 cookie 的真实入口测试（D37）：真实 cordis + webserver + storage 栈。
 *
 * 场景是「外层会话有效、宿主那层不认」：门放行，但宿主的 `requestRejection` 回 401。这时
 * 守卫必须 302 到相对 `/?token=` 并下发一次性标记，而不是把宿主的 401 原样交给用户。
 *
 * `Sec-Fetch-*` 是浏览器保留头，undici fetch 会改写，所以这里用 node:http 直发。
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

const nav = (site = "same-origin"): Record<string, string> => ({
  "sec-fetch-site": site,
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
});

/** 登录拿外层会话 cookie（token 模式）。 */
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

describe("integration: host-cookie rebridge", () => {
  it("宿主不认时 302 到相对 /?token= 并下发一次性标记", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "rejecting",
    });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      const res = await rawGet(port, "/", { cookie, ...nav() });
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe("/?token=launchTok-it");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      const setCookie = res.headers["set-cookie"];
      expect(Array.isArray(setCookie) ? setCookie.join(";") : setCookie).toContain(
        "dsh_auth_rebridge=1",
      );
      // 重铸不调用原入口：首页正文不该出现。
      expect(res.body).not.toContain("index");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("标记还在时不再重铸，把宿主的 401 原样交出去（不循环）", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "rejecting",
    });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      const res = await rawGet(port, "/", {
        cookie: `${cookie}; dsh_auth_rebridge=1`,
        ...nav(),
      });
      expect(res.status).toBe(200);
      expect(res.body).toBe("index");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("宿主认了就不重铸，首页照常返回", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "accepting",
    });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      const res = await rawGet(port, "/", { cookie, ...nav() });
      expect(res.status).toBe(200);
      expect(res.body).toBe("index");
    } finally {
      await unmountStack(fibers, root);
    }
  });
});

describe("integration: host-cookie rebridge leaves other entries alone", () => {
  it("未认证的导航仍然去登录页，不重铸", async () => {
    const { port, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "rejecting",
    });
    try {
      const res = await rawGet(port, "/", nav());
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe("/auth/login?next=%2F");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("登录桥的换票那一跳不重铸（否则会 302 到同一个地址，每次登录多一跳）", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "rejecting",
    });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      // 宿主此刻还没签发 cookie，`requestRejection` 必然回 401；这一跳必须原样放行给宿主，
      // 让它自己去换票（issue #99 的语义：第二跳不 302）。
      const res = await rawGet(port, "/?token=launchTok-it", { cookie, ...nav() });
      expect(res.status).toBe(200);
      expect(res.headers["location"]).toBeUndefined();
      expect(res.body).toBe("index");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("跨站导航先拿弹回页，不重铸（重铸的 Strict cookie 在跨站链上不会被发送）", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "rejecting",
    });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      const res = await rawGet(port, "/", { cookie, ...nav("cross-site") });
      expect(res.status).toBe(200);
      expect(res.body).toContain("location.replace(location.href)");
      expect(res.headers["location"]).toBeUndefined();
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("API 请求不重铸（302 到 /?token= 对 fetch 没有意义）", async () => {
    const { port, token, fibers, root } = await mountStack({
      withCredentials: true,
      connection: "rejecting",
    });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      const res = await rawGet(port, "/__probe", { cookie });
      expect(res.status).toBe(200);
      expect(res.body).toBe("probe");
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("没有 connection 服务时行为不变（旧版 dsh）", async () => {
    const { port, token, fibers, root } = await mountStack({ withCredentials: true });
    try {
      const cookie = await login(`http://127.0.0.1:${port}`, token);
      const res = await rawGet(port, "/", { cookie, ...nav() });
      expect(res.status).toBe(200);
      expect(res.body).toBe("index");
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
