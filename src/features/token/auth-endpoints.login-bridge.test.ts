import { describe, expect, it } from "vitest";
import {
  handlerOf,
  loginReq,
  makeHarness,
  makeRes,
  type Harness,
} from "../../../test/token-endpoints-harness.js";
import { registerAuthEndpoints } from "./auth-endpoints.js";

/** 装配 token 端点，按需注入桥（缺省 = 未配置桥的老行为）。 */
function mount(bridge?: () => Promise<string | undefined>): Harness {
  const harness = makeHarness();
  if (bridge !== undefined) harness.deps.launchTokenBridge = bridge;
  registerAuthEndpoints(harness.deps);
  return harness;
}

/** 提交一次登录，返回响应夹具。 */
async function login(harness: Harness, body = "token=good-token&next=%2Fok") {
  const res = makeRes();
  await handlerOf(harness, "exact", "/auth/login")(loginReq(body), res.res);
  return res;
}

/**
 * token 模式的 launch-token 桥（issue #99）：成功 302 与 password 模式同形，
 * 失败一律回落 `next` 且不影响登录成功。
 */
describe("POST /auth/login (token mode): launch-token bridge", () => {
  it("redirects to the relative bridged URL and still issues the session cookie", async () => {
    const harness = mount(() => Promise.resolve("/?token=launch"));
    const res = await login(harness);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/?token=launch");
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(harness.logs).toContainEqual({ level: "info", message: "session issued" });
  });

  it("falls back to next when the bridge returns undefined", async () => {
    const harness = mount(() => Promise.resolve(undefined));
    const res = await login(harness);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("falls back to next when the bridge throws (never blocks login)", async () => {
    const harness = mount(() => Promise.reject(new Error("connection gone")));
    const res = await login(harness);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
    expect(harness.logs).toContainEqual({
      level: "warn",
      message: "launch-token bridge failed; falling back to plain redirect",
    });
  });

  it("refuses a bridge location that is not a same-site relative path", async () => {
    const harness = mount(() => Promise.resolve("//evil.com"));
    const res = await login(harness);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(harness.logs).toContainEqual({
      level: "warn",
      message: "launch-token bridge returned an unsafe location; falling back to plain redirect",
    });
  });

  it("keeps the plain next redirect when no bridge is injected", async () => {
    const harness = mount();
    const res = await login(harness);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(harness.logs.some((entry) => entry.level === "warn")).toBe(false);
  });
});

/** 失败路径不得碰桥：401 与 503 都在会话签发之前返回，Location 里也不许出现 launch token。 */
describe("POST /auth/login (token mode): the bridge stays out of failure paths", () => {
  it("never consults the bridge on a rejected token", async () => {
    let called = 0;
    const harness = mount(() => {
      called += 1;
      return Promise.resolve("/?token=leak");
    });
    const res = await login(harness, "token=wrong&next=%2Fok");
    expect(res.status).toBe(401);
    expect(called).toBe(0);
    expect(res.headers["location"]).toBeUndefined();
    expect(res.body).not.toContain("leak");
  });

  it("never consults the bridge when the session store is unavailable", async () => {
    let called = 0;
    const harness = mount(() => {
      called += 1;
      return Promise.resolve("/?token=leak");
    });
    harness.setStore(undefined);
    const res = await login(harness);
    expect(res.status).toBe(503);
    expect(called).toBe(0);
    expect(res.headers["location"]).toBeUndefined();
  });
});
