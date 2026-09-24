/**
 * `GET /auth/login` 的 notice 槽（P1.1 / D24）。
 *
 * 白名单解析 + 渲染在密码卡上的独立性，都要在这里可观察；POST 失败页必须完全不受影响。
 * 渲染细节（槽位、转义、顺序）在 `shared/login-page-notice.test.ts`；真实 HTTP 由
 * `integration.password-change.test.ts` 覆盖。
 */
import { describe, expect, it } from "vitest";
import type { FakeRes } from "./password-endpoints-login-harness.js";
import {
  handlerOf,
  loginGetReq,
  loginReq,
  makeHarness,
  makeRes,
} from "./password-endpoints-login-harness.js";
import { registerPasswordEndpoints } from "./password-endpoints.js";

const NOTICE = "Your password was changed. Sign in with your new password.";

/** 发一个 GET /auth/login（notice 只可能在 GET 的 query 上）。 */
async function getLogin(url: string): Promise<FakeRes> {
  const harness = makeHarness();
  registerPasswordEndpoints(harness.deps);
  const res = makeRes();
  await handlerOf(harness, "exact", "/auth/login")(loginGetReq(url), res.res);
  return res;
}

describe("GET /auth/login: notice (P1.1)", () => {
  it("renders the compiled-in copy for the whitelisted key, in its own status slot", async () => {
    const res = await getLogin("/auth/login?notice=password-changed&next=%2F");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain(`<p class="notice" role="status">${NOTICE}</p>`);
    expect(res.body).not.toContain('id="err"'); // 不进错误槽
  });

  it("keeps next validation intact when a notice is present", async () => {
    const res = await getLogin("/auth/login?next=%2F%2Fevil.com&notice=password-changed");
    expect(res.body).toContain('<input type="hidden" name="next" value="/">');
    expect(res.body).not.toContain("evil.com");
    expect(res.body).toContain(NOTICE);
  });

  it("never reads the notice on a POST failure re-render", async () => {
    const harness = makeHarness();
    registerPasswordEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(
      loginReq("username=alice&password=wrong", "127.0.0.1", "/auth/login?notice=password-changed"),
      res.res,
    );
    expect(res.status).toBe(401);
    expect(res.body).toContain("Invalid username or password.");
    expect(res.body).not.toContain('class="notice"');
  });
});

describe("GET /auth/login: notice whitelist", () => {
  it.each([
    ["empty", ""],
    ["case variant", "Password-changed"],
    ["trailing space", "password-changed%20"],
    ["html payload", "%3Cscript%3Ealert(1)%3C%2Fscript%3E"],
    ["oversized", "x".repeat(4096)],
  ])("ignores the %s value without reflecting it", async (_label, raw) => {
    const res = await getLogin(`/auth/login?notice=${raw}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('class="notice"');
    expect(res.body).not.toContain("alert(1)");
    expect(res.body).not.toContain("password-changed");
  });

  it("uses the whitelist on the FIRST duplicate value and never echoes the rest", async () => {
    const ok = await getLogin(
      "/auth/login?notice=password-changed&notice=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    );
    expect(ok.body).toContain(NOTICE);
    expect(ok.body).not.toContain("alert(1)");

    const bad = await getLogin(
      "/auth/login?notice=%3Cscript%3Ealert(1)%3C%2Fscript%3E&notice=password-changed",
    );
    expect(bad.body).not.toContain('class="notice"');
    expect(bad.body).not.toContain("alert(1)");
  });
});
