import { describe, expect, it } from "vitest";
import { SessionStore } from "../../../entities/session/index.js";
import { fakeReq, makeRes, MemTable, probeOf } from "../../../../../test/bootstrap-harness.js";
import { makeBootstrapEndpoint, type BootstrapEndpointDeps } from "./bootstrap-endpoint.js";
import type { ConfiguredState } from "../model/probe.js";

const LOGIN_REDIRECT = "/auth/login?next=%2F";

function harness(overrides: Partial<BootstrapEndpointDeps> = {}): {
  deps: BootstrapEndpointDeps;
  store: SessionStore;
  logs: { level: string; message: unknown }[];
} {
  const store = new SessionStore(new MemTable());
  const logs: { level: string; message: unknown }[] = [];
  const deps: BootstrapEndpointDeps = {
    probe: probeOf("unconfigured"),
    readLaunchToken: () => "launch-token",
    sessions: () => store,
    cookieName: "dsh_auth",
    cookieSecure: false,
    sessionTtlSeconds: 604800,
    logger: {
      error: (message) => logs.push({ level: "error", message }),
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
    },
    ...overrides,
  };
  return { deps, store, logs };
}

function cookieValue(setCookie: string | undefined): string {
  expect(setCookie).toBeDefined();
  return setCookie!.split(";")[0]!.split("=")[1]!;
}

describe("GET /auth/bootstrap", () => {
  it("issues a bootstrap session and redirects to the wizard", async () => {
    const { deps, store, logs } = harness();
    const res = makeRes();
    await makeBootstrapEndpoint(deps)(
      fakeReq({ url: "/auth/bootstrap?token=launch-token" }),
      res.res,
    );

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/setup");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    const cookie = res.headers["set-cookie"]!;
    expect(cookie).toContain("dsh_auth=");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // secure=false（测试/HTTP 开发）时不能带 Secure，否则 cookie 落不了地。
    expect(cookie).not.toContain("Secure");
    expect(store.getByToken(cookieValue(cookie))?.kind).toBe("bootstrap");
    // 响应里绝不出现 launch token（Location 指向站点内路径，不是带 token 的 URL）。
    expect(JSON.stringify(res.headers)).not.toContain("launch-token");
    expect(res.body).toBe("");
    expect(logs.some((log) => log.level === "info")).toBe(true);
  });

  it("caps the bootstrap lifetime at one hour and honours a shorter configured TTL", async () => {
    const capped = makeRes();
    await makeBootstrapEndpoint(harness().deps)(
      fakeReq({ url: "/auth/bootstrap?token=launch-token" }),
      capped.res,
    );
    expect(capped.headers["set-cookie"]).toContain("Max-Age=3600");

    const shorter = makeRes();
    await makeBootstrapEndpoint(harness({ sessionTtlSeconds: 120 }).deps)(
      fakeReq({ url: "/auth/bootstrap?token=launch-token" }),
      shorter.res,
    );
    expect(shorter.headers["set-cookie"]).toContain("Max-Age=120");
  });
});

describe("GET /auth/bootstrap: refusal paths", () => {
  it("refuses malformed, wrong-token and already-configured requests without a cookie", async () => {
    const unreachable = (): never => {
      throw new Error("sessions must not be touched");
    };
    const cases: { deps: Partial<BootstrapEndpointDeps>; url: string }[] = [
      { deps: {}, url: "/auth/bootstrap?token=wrong-token" },
      { deps: {}, url: "/auth/bootstrap?token=launch-token&token=launch-token" },
      { deps: {}, url: "/auth/bootstrap" },
      { deps: {}, url: "/auth/bootstrap?token=%20" },
      { deps: { readLaunchToken: () => undefined }, url: "/auth/bootstrap?token=launch-token" },
      { deps: { readLaunchToken: () => "" }, url: "/auth/bootstrap?token=launch-token" },
      { deps: { probe: probeOf("configured") }, url: "/auth/bootstrap?token=launch-token" },
      { deps: { probe: probeOf("unknown") }, url: "/auth/bootstrap?token=launch-token" },
      { deps: { sessions: () => undefined }, url: "/auth/bootstrap?token=launch-token" },
      { deps: { sessions: unreachable }, url: "/auth/bootstrap" },
    ];
    for (const testCase of cases) {
      const res = makeRes();
      await makeBootstrapEndpoint(harness(testCase.deps).deps)(
        fakeReq({ url: testCase.url }),
        res.res,
      );
      expect({ url: testCase.url, status: res.status, location: res.headers["location"] }).toEqual({
        url: testCase.url,
        status: 302,
        location: LOGIN_REDIRECT,
      });
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(res.body).not.toContain("launch-token");
    }
  });

  it("treats every non-unconfigured probe state as refuse", async () => {
    const states: ConfiguredState[] = ["configured", "unknown"];
    for (const state of states) {
      const res = makeRes();
      await makeBootstrapEndpoint(harness({ probe: probeOf(state) }).deps)(
        fakeReq({ url: "/auth/bootstrap?token=launch-token" }),
        res.res,
      );
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("fails closed when the store refuses to create the session", async () => {
    const logs: { level: string; message: unknown }[] = [];
    const refusing = {
      create: () => Promise.reject(new Error("store gone")),
    } as unknown as SessionStore;
    const res = makeRes();
    await makeBootstrapEndpoint(
      harness({
        sessions: () => refusing,
        logger: {
          error: (message) => logs.push({ level: "error", message }),
          info: (message) => logs.push({ level: "info", message }),
          warn: (message) => logs.push({ level: "warn", message }),
        },
      }).deps,
    )(fakeReq({ url: "/auth/bootstrap?token=launch-token" }), res.res);

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(logs.filter((log) => log.level === "warn")).toHaveLength(1);
  });

  it("answers 405 for any non-GET method", async () => {
    for (const method of ["POST", "HEAD", "PUT", "DELETE"]) {
      const res = makeRes();
      await makeBootstrapEndpoint(harness().deps)(
        fakeReq({ method, url: "/auth/bootstrap?token=launch-token" }),
        res.res,
      );
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("GET");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });
});
