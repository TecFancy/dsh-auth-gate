/**
 * `GET /auth/login` 的 passkey 入口透传（M6 §5.7）：端点只负责把 `deps.passkey` 交给密码卡，
 * 是否渲染由 `shared/login-page` 决定；TOTP 挑战页不带入口。
 */
import { describe, expect, it } from "vitest";
import {
  handlerOf,
  loginGetReq,
  makeHarness,
  makeRes,
} from "../../../../../test/password-login-harness.js";
import { registerPasswordEndpoints } from "./password-endpoints.js";

interface PasskeyOption {
  enabled: boolean;
  conditionalUi: boolean;
}

/** 发一个 GET /auth/login 并返回 HTML。 */
async function getLogin(url: string, passkey?: PasskeyOption): Promise<string> {
  const harness = makeHarness();
  if (passkey !== undefined) harness.deps.passkey = () => passkey;
  registerPasswordEndpoints(harness.deps);
  const res = makeRes();
  await handlerOf(harness, "exact", "/auth/login")(loginGetReq(url), res.res);
  expect(res.status).toBe(200);
  return res.body;
}

describe("GET /auth/login: passkey entry (M6 §5.7)", () => {
  it("renders no passkey entry when the wiring is absent", async () => {
    const body = await getLogin("/auth/login");
    expect(body).not.toContain("passkey");
  });

  it("passes deps.passkey through to the password card", async () => {
    const body = await getLogin("/auth/login", { enabled: true, conditionalUi: true });
    expect(body).toContain('id="passkey-btn"');
    expect(body).toContain('action="/auth/passkey/login"');
    expect(body).toContain('autocomplete="username webauthn"');
  });

  it("passes deps.passkey through on the ?stage=password reset page too", async () => {
    const body = await getLogin("/auth/login?stage=password", {
      enabled: true,
      conditionalUi: false,
    });
    expect(body).toContain('id="passkey-form"');
    expect(body).toContain('autocomplete="username"');
    expect(body).not.toContain("isConditionalMediationAvailable");
  });
});

describe("GET /auth/login: passkey entry reads the runtime toggle", () => {
  it("reflects a conditional-UI change made after the endpoints were registered", async () => {
    // 条件 UI 开关可以在设置页运行时改写：登录页必须每次渲染现取，不能缓存注册时的快照
    // （2026-11-12 在隔离实例里实测到快照会让开关失效）。
    const harness = makeHarness();
    let conditionalUi = false;
    harness.deps.passkey = () => ({ enabled: true, conditionalUi });
    registerPasswordEndpoints(harness.deps);
    const first = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginGetReq("/auth/login"), first.res);
    expect(first.body).toContain('id="passkey-btn"');
    expect(first.body).not.toContain("isConditionalMediationAvailable");

    conditionalUi = true;
    const second = makeRes();
    await handlerOf(harness, "exact", "/auth/login")(loginGetReq("/auth/login"), second.res);
    expect(second.body).toContain("isConditionalMediationAvailable");
  });
});
