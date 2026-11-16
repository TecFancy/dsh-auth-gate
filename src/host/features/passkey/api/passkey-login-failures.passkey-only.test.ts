/**
 * passkey 登录失败卡在 `passkey: "required"` 下的形状（issue #133）。
 *
 * 口令可用时失败卡是「口令表单 + passkey 重试入口」；passkey-only 下那张卡上没有口令表单，
 * 文案也不能再写「改用密码」 - 那条路已经被策略关掉了，写出来只会把用户引向死路。
 */
import { describe, expect, it } from "vitest";
import type { PasskeyRecord, UserRecord } from "../../../entities/user/index.js";
import { PASSKEY_LOGIN_PATH, PASSKEY_OPTIONS_PATH } from "../../../shared/protocol/index.js";
import { PASSKEY_ONLY_ERROR_TEXT } from "../../../shared/login-page/index.js";
import { makeReq, makeRes, type FakeRes } from "../../../../../test/token-endpoints-harness.js";
import {
  PasskeyAuthenticator,
  makePasskeyLoginHarness,
  routeHandler,
  TEST_RP_ID,
  type PasskeyLoginHarness,
} from "../../../../../test/passkey-authenticator-harness.js";
import {
  PASSKEY_LOGIN_FAILED_MESSAGE,
  PASSKEY_LOGIN_LOCKED_MESSAGE,
} from "./passkey-login-failures.js";
import { registerPasskeyLoginEndpoints } from "./passkey-login-endpoints.js";

/** 一个已注册凭据的用户（与 reject 测试同形）。 */
function userWith(authenticator: PasskeyAuthenticator): UserRecord {
  const record: PasskeyRecord = {
    credentialId: authenticator.credentialId,
    publicKeyCose: authenticator.publicKeyCose,
    alg: -7,
    signCount: 0,
    aaguid: "",
    be: false,
    bs: false,
    uvInitialized: true,
    transports: ["internal"],
    label: "Test key",
    createdAt: 1,
    lastUsedAt: 0,
  };
  return { passwordHash: "h", disabled: false, passkeys: [record] };
}

/** 走一次 begin + 一次注定失败的 finish（断言字段缺失 → 401）。 */
async function failedLogin(harness: PasskeyLoginHarness): Promise<FakeRes> {
  const begin = makeRes();
  await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
    makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
    begin.res,
  );
  const cookie = begin.headers["set-cookie"]!.split(";")[0]!;
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_LOGIN_PATH)(
    makeReq({
      method: "POST",
      url: PASSKEY_LOGIN_PATH,
      cookie,
      contentType: "application/x-www-form-urlencoded",
      body: Buffer.from("id=&client_data_json=&authenticator_data=&signature="),
    }),
    res.res,
  );
  return res;
}

describe("passkey failure card: password login available", () => {
  it("keeps the password form and the passkey retry entry", async () => {
    const authenticator = new PasskeyAuthenticator({ rpId: TEST_RP_ID, userHandle: "uh" });
    const harness = makePasskeyLoginHarness();
    harness.users.set("alice", userWith(authenticator));
    registerPasskeyLoginEndpoints(harness.deps);
    const res = await failedLogin(harness);
    expect(res.status).toBe(401);
    expect(res.body).toContain(PASSKEY_LOGIN_FAILED_MESSAGE);
    expect(res.body).toContain('name="password"');
    expect(res.body).toContain('id="passkey-btn"');
  });
});

describe("passkey failure card: passkey-only", () => {
  it("drops the password form and the 'use your password' wording", async () => {
    const authenticator = new PasskeyAuthenticator({ rpId: TEST_RP_ID, userHandle: "uh" });
    const harness = makePasskeyLoginHarness({ passwordLoginDisabled: true });
    harness.users.set("alice", userWith(authenticator));
    registerPasskeyLoginEndpoints(harness.deps);
    const res = await failedLogin(harness);
    expect(res.status).toBe(401);
    expect(res.body).not.toContain('name="password"');
    expect(res.body).not.toContain(PASSKEY_LOGIN_FAILED_MESSAGE);
    expect(res.body).toContain(PASSKEY_ONLY_ERROR_TEXT);
    // 重试入口仍在：passkey-only 下这是唯一的路。
    expect(res.body).toContain('id="passkey-btn"');
  });

  it("uses the passkey-only card for the 429 lockout too", async () => {
    const harness = makePasskeyLoginHarness({ passwordLoginDisabled: true });
    registerPasskeyLoginEndpoints(harness.deps);
    // 把 IP 桶打满：连续失败直到 429。
    let res = await failedLogin(harness);
    for (let attempt = 0; attempt < 12 && res.status !== 429; attempt += 1) {
      res = await failedLogin(harness);
    }
    expect(res.status).toBe(429);
    expect(res.body).toContain(PASSKEY_LOGIN_LOCKED_MESSAGE);
    expect(res.body).not.toContain('name="password"');
  });
});
