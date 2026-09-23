import { describe, expect, it } from "vitest";
import {
  handlerOf,
  loginReq,
  makeHarness,
  makeRes,
} from "../../../test/token-endpoints-harness.js";
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
