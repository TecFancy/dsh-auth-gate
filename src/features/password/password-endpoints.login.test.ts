import { DUMMY_HASH } from "./password.js";
import { registerPasswordEndpoints } from "./password-endpoints.js";
import { handlerOf, loginReq, makeHarness, makeRes } from "./password-endpoints-login-harness.js";
import { describe, expect, it } from "vitest";

describe("POST /auth/login: success", () => {
  it("issues a session with the username subject and exact cookie flags", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw&next=%2Fok"), res.res);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(res.headers["set-cookie"]).toMatch(
      /^dsh_auth=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    expect(harness.table.size).toBe(1);
    expect(harness.logs).toContainEqual({ level: "info", message: "session issued" });
  });

  it("succeeds without a next parameter (defaults to /)", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(302);
  });
});

describe("POST /auth/login: rejection", () => {
  it("rejects a wrong password with 401 and counts a failure", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=wrong"), res.res);
    expect(res.status).toBe(401);
    expect(res.body).toContain('class="error"'); // D20：HTML 卡片而非裸文本
    expect(harness.table.size).toBe(0);
    expect(harness.logs).toContainEqual({ level: "info", message: "login rejected" });
  });

  it("verifies against DUMMY_HASH for unknown users (enumeration-proof)", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=ghost&password=pw"), res.res);
    expect(res.status).toBe(401);
    expect(harness.verifyCalls).toEqual([{ storedHash: DUMMY_HASH, password: "pw" }]);
  });

  it("still verifies the real hash for disabled users before rejecting", async () => {
    const harness = makeHarness();
    harness.setUsers(new Map([["alice", { passwordHash: "h-alice", disabled: true }]]));
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("username=alice&password=pw"), res.res);
    expect(res.status).toBe(401);
    expect(harness.verifyCalls).toEqual([{ storedHash: "h-alice", password: "pw" }]);
  });

  it("validates next: //evil.com and /auth/* fall back to /", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    for (const [next, expected] of [
      ["//evil.com", "/"],
      ["/ok/path", "/ok/path"],
      ["/auth/", "/"], // /auth 与 /auth/* 同一规则（next !== "/auth" && !startsWith("/auth/")）
      // 控制符：TAB 会被浏览器在解析 URL 前剥掉，"/\t/evil.com" 等于 "//evil.com"；
      // CR/LF/NUL 则让 Node writeHead 抛 ERR_INVALID_CHAR，宿主 webserver 兜成 400。
      ["/\t/evil.com", "/"],
      ["/x\r\nSet-Cookie: y=1", "/"],
      ["/x\u0000y", "/"],
    ] as const) {
      const res = makeRes();
      await handlerOf(
        harness,
        "exact",
        "/auth/login",
      )(loginReq(`username=alice&password=pw&next=${encodeURIComponent(next)}`), res.res);
      expect(res.headers["location"]).toBe(expected);
    }
  });
});
