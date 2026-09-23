import { describe, expect, it } from "vitest";
import { digestToken } from "../../session/index.js";
import {
  handlerOf,
  loginReq,
  makeHarness,
  makeReq,
  makeRes,
} from "../../../test/token-endpoints-harness.js";
import { INVALID_TOKEN, registerAuthEndpoints } from "./auth-endpoints.js";

describe("POST /auth/login: success and rejection", () => {
  it("issues a session on a valid token", async () => {
    const harness = makeHarness({ cookieSecure: true });
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("token=good-token&next=%2Fok"), res.res);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/ok");
    expect(harness.table.size).toBe(1);
    const issuedToken = res.headers["set-cookie"]!.split(";")[0]!.split("=")[1]!;
    const issued = harness.table.get(digestToken(issuedToken))!;
    expect(issued.subject).toBe("token");
    expect(issued.expiresAt - issued.createdAt).toBe(604800 * 1000);
    expect(res.headers["set-cookie"]).toMatch(
      /^dsh_auth=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(harness.table.get(digestToken(issuedToken))?.subject).toBe("token");
    expect(harness.logs).toContainEqual({ level: "info", message: "session issued" });
  });

  it("omits Secure in the cookie when cookieSecure=false", async () => {
    const harness = makeHarness({ cookieSecure: false });
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=good-token"), res.res);
    expect(res.headers["set-cookie"]).toMatch(
      /^dsh_auth=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/,
    );
  });

  it("rejects an invalid token without creating a session", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=wrong&next=%2Fok"), res.res);
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain('class="error"');
    expect(res.body).toContain(INVALID_TOKEN);
    expect(harness.table.size).toBe(0);
    expect(harness.logs).toContainEqual({ level: "info", message: "login rejected" });
  });

  it("validates next: //evil.com and /auth/* fall back to /", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    for (const [next, expected] of [
      ["//evil.com", "/"],
      ["/ok/path", "/ok/path"],
      ["/auth/login", "/"],
      ["/auth/x", "/"],
    ] as const) {
      const res = makeRes();
      await handlerOf(
        harness,
        "exact",
        "/auth/login",
      )(loginReq(`token=good-token&next=${encodeURIComponent(next)}`), res.res);
      expect(res.headers["location"]).toBe(expected);
    }
  });
});

describe("POST /auth/login: error paths", () => {
  it("returns 503 when the session store is unavailable", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    harness.setStore(undefined);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=good-token"), res.res);
    expect(res.status).toBe(503);
    expect(res.body).toBe("session store unavailable");
    expect(harness.logs).toContainEqual({
      level: "error",
      message: "login failed: session store unavailable",
    });
  });

  it("rejects a non-urlencoded content type with 415", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("token=good-token", "text/plain"), res.res);
    expect(res.status).toBe(415);
    expect(res.headers["content-type"]).toBe("text/plain");
  });

  it("responds 413 with connection: close on an oversized body", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(
      makeReq({
        method: "POST",
        url: "/auth/login",
        contentType: "application/x-www-form-urlencoded",
        body: Buffer.alloc(16 * 1024 + 1, 0x61),
      }),
      res.res,
    );
    expect(res.status).toBe(413);
    expect(res.headers["connection"]).toBe("close");
    expect(res.headers["content-type"]).toBe("text/plain"); // D21：刻意不改（M19 形状冻结）
  });
});
