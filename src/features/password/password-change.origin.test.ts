import { describe, expect, it } from "vitest";
import {
  GOOD_BODY,
  jsonBody,
  makeHarness,
  makeReq,
  makeRes,
  type FakeRes,
} from "../../../test/password-change-harness.js";
import { handlePasswordChange, type PasswordChangeDeps } from "./password-change.js";

/** 对外来源（带 scheme：反代后面的运营侧建议写法）。 */
const PUBLIC_ORIGIN = "https://dsh.example.com";

/** POST 直达：不自动补任何来源头，由用例自己决定。 */
async function post(
  deps: PasswordChangeDeps,
  headers: Record<string, string>,
  body = GOOD_BODY,
  cookie: string | null = "dsh_auth=good",
): Promise<FakeRes> {
  const res = makeRes();
  // secFetchSite: null = 共享夹具不注入默认同源头，由本文件的用例自己给（正例/反例都要精确）。
  const req = makeReq({ body, cookie, secFetchSite: null });
  Object.assign(req.headers, headers);
  await handlePasswordChange(deps, req, res.res);
  return res;
}

/** 按 publicHost 造 deps（缺省 = 未配置，只剩 Sec-Fetch-Site 通道）。 */
function depsWithPublicHost(publicHost?: string): PasswordChangeDeps {
  return publicHost === undefined ? makeHarness().deps : makeHarness({ publicHost }).deps;
}

describe("POST /auth/password: accepted origins (contract 15)", () => {
  it("accepts Sec-Fetch-Site: same-origin (trimmed, case-insensitive)", async () => {
    for (const value of ["same-origin", " SAME-ORIGIN "]) {
      const res = await post(depsWithPublicHost(), { "sec-fetch-site": value });
      expect([value, res.status]).toEqual([value, 200]);
    }
  });

  it("accepts an Origin exactly equal to the configured publicHost", async () => {
    const res = await post(depsWithPublicHost(PUBLIC_ORIGIN), { origin: PUBLIC_ORIGIN });
    expect(res.status).toBe(200);
    expect(jsonBody(res)).toEqual({ ok: true });
  });

  it("accepts a matching Origin even when Sec-Fetch-Site disagrees (either channel passes)", async () => {
    const res = await post(depsWithPublicHost(PUBLIC_ORIGIN), {
      origin: PUBLIC_ORIGIN,
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(200);
  });

  it("derives https from the TLS socket for a scheme-less publicHost", async () => {
    const res = makeRes();
    const req = makeReq({ body: GOOD_BODY });
    Reflect.set(req.socket, "encrypted", true);
    req.headers.origin = PUBLIC_ORIGIN;
    await handlePasswordChange(makeHarness({ publicHost: "dsh.example.com" }).deps, req, res.res);
    expect(res.status).toBe(200);
  });
});

describe("POST /auth/password: fail-closed rejection (contract 15)", () => {
  it("rejects a request with neither Origin nor Sec-Fetch-Site", async () => {
    const h = makeHarness();
    const res = await post(h.deps, {});
    expect(res.status).toBe(403);
    expect(jsonBody(res)).toEqual({ error: "bad_origin" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(h.state.writes).toBe(0);
  });

  it("never falls back to Host when publicHost is unconfigured", async () => {
    const res = await post(depsWithPublicHost(), {
      origin: PUBLIC_ORIGIN,
      host: "dsh.example.com",
    });
    expect(res.status).toBe(403);
  });

  it("rejects an Origin when publicHost is unconfigured", async () => {
    const res = await post(depsWithPublicHost(), { origin: PUBLIC_ORIGIN });
    expect(res.status).toBe(403);
  });

  it.each([
    ["subdomain", "https://a.dsh.example.com"],
    ["same-site but not same-origin", "https://other.example.com"],
    ["plain http against https publicHost", "http://dsh.example.com"],
  ])("rejects a %s Origin", async (_label, origin) => {
    const res = await post(depsWithPublicHost(PUBLIC_ORIGIN), { origin });
    expect(res.status).toBe(403);
  });

  it("rejects Origin: null and a cross-site Sec-Fetch-Site", async () => {
    expect((await post(depsWithPublicHost(PUBLIC_ORIGIN), { origin: "null" })).status).toBe(403);
    expect(
      (await post(depsWithPublicHost(PUBLIC_ORIGIN), { "sec-fetch-site": "cross-site" })).status,
    ).toBe(403);
  });

  it("rejects multiple Origin values instead of matching any of them", async () => {
    const res = await post(depsWithPublicHost(PUBLIC_ORIGIN), {
      origin: `${PUBLIC_ORIGIN}, https://evil.example.com`,
    });
    expect(res.status).toBe(403);
  });

  it("rejects a scheme mismatch for a scheme-less publicHost on plaintext", async () => {
    const res = await post(depsWithPublicHost("dsh.example.com"), { origin: PUBLIC_ORIGIN });
    expect(res.status).toBe(403);
  });
});

describe("POST /auth/password: ordering and side effects", () => {
  it("answers 403 before the session lookup (no fake 401 for a missing Origin)", async () => {
    const res = await post(makeHarness().deps, {}, GOOD_BODY, null);
    expect(res.status).toBe(403);
  });

  it("still answers 401 for a missing session once the origin is proven", async () => {
    const res = await post(
      makeHarness().deps,
      { "sec-fetch-site": "same-origin" },
      GOOD_BODY,
      null,
    );
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "unauthorized" });
  });

  it("parses the body before the origin gate (415 wins over 403)", async () => {
    const res = makeRes();
    await handlePasswordChange(
      makeHarness().deps,
      makeReq({ body: "{}", contentType: "application/json" }),
      res.res,
    );
    expect(res.status).toBe(415);
  });

  it("does not count a rejected origin as a rate-limit failure", async () => {
    const h = makeHarness();
    await post(h.deps, {});
    expect(h.limiter.check("127.0.0.1", "alice").allowed).toBe(true);
    expect(h.state.revokes).toBe(0);
  });

  it("does not origin-check the GET page (navigation is not a state change)", async () => {
    const res = makeRes();
    const req = makeReq({ method: "GET", cookie: null });
    req.url = "/auth/password";
    await handlePasswordChange(makeHarness().deps, req, res.res);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/login?next=/auth/password");
  });
});
