import { describe, expect, it } from "vitest";
import {
  handlerOf,
  loginReq,
  makeHarness,
  makeRes,
} from "../../../../../test/token-endpoints-harness.js";
import { INVALID_TOKEN, registerAuthEndpoints } from "./auth-endpoints.js";

/** D21：错 token 的 401 必须是登录卡片（浏览器可见错误），而不是空白纯文本页。 */
describe("POST /auth/login: D21 failure card", () => {
  it("renders the token card with the error slot, the next field and the Error: title", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=wrong&next=%2Fok"), res.res);
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain('class="error"');
    expect(res.body).toContain(INVALID_TOKEN);
    expect(res.body).toContain('<input type="hidden" name="next" value="/ok">');
    expect(res.body).toContain("<title>Error: Sign in");
  });

  it("keeps the token field usable and never echoes the submission", async () => {
    const harness = makeHarness();
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(
      harness,
      "exact",
      "/auth/login",
    )(loginReq("token=%3Cscript%3Ealert(1)%3C%2Fscript%3E"), res.res);
    expect(res.status).toBe(401);
    expect(res.body).not.toContain("alert(1)"); // 既不原样回显也不转义回显：令牌字段无 value
    expect(res.body).toMatch(/<input id="token"[^>]*autofocus/);
    expect(res.body).toContain('aria-invalid="true" aria-describedby="err"');
  });

  it("renders the configured publicHost (anti-phishing, D14)", async () => {
    const harness = makeHarness();
    harness.deps.publicHost = "dsh.example.com";
    registerAuthEndpoints(harness.deps);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=wrong"), res.res);
    expect(res.status).toBe(401);
    expect(res.body).toContain('class="host"');
    expect(res.body).toContain("dsh.example.com");
  });
});

/** D21 的同一张卡片覆盖 429：token 域在 D39 后有了限速器，裸文本 429 会退回白页。 */
describe("POST /auth/login: token lockout card", () => {
  async function burnTokens(harness: ReturnType<typeof makeHarness>, count: number): Promise<void> {
    registerAuthEndpoints(harness.deps);
    const handler = handlerOf(harness, "exact", "/auth/login");
    for (let attempt = 0; attempt < count; attempt += 1) {
      await handler(loginReq("token=wrong&next=%2Fok"), makeRes().res);
    }
  }

  it("answers the sixth attempt with the login card instead of a bare text page", async () => {
    const harness = makeHarness();
    await burnTokens(harness, 5);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=wrong&next=%2Fok"), res.res);
    expect(res.status).toBe(429);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain('class="error"');
    expect(res.body).toContain("Too many sign-in attempts from this network.");
    expect(res.body).toContain("Try again in 30 seconds.");
    expect(res.body).toContain('<input type="hidden" name="next" value="/ok">');
    expect(res.body).toContain("<title>Error: Sign in");
  });

  it("keeps the token field usable on the lockout card and never echoes the submission", async () => {
    const harness = makeHarness();
    await burnTokens(harness, 5);
    const res = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginReq("token=super-secret-token"), res.res);
    expect(res.status).toBe(429);
    expect(res.body).not.toContain("super-secret-token");
    expect(res.body).toMatch(/<input id="token"[^>]*autofocus/);
    expect(res.body).toContain('aria-invalid="true" aria-describedby="err"');
  });
});
