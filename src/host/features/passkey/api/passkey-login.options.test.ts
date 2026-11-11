import { describe, expect, it } from "vitest";
import { PASSKEY_PERMISSIONS_POLICY } from "../../../shared/http/index.js";
import { PASSKEY_OPTIONS_PATH } from "../../../shared/protocol/index.js";
import { makeReq, makeRes, type FakeRes } from "../../../../../test/token-endpoints-harness.js";
import {
  makePasskeyLoginHarness,
  routeHandler,
  TEST_RP_ID,
  type PasskeyLoginHarness,
} from "../../../../../test/passkey-authenticator-harness.js";
import { PasskeyOptionsQuota } from "../model/options-quota.js";
import { registerPasskeyLoginEndpoints } from "./passkey-login-endpoints.js";

async function requestOptions(harness: PasskeyLoginHarness, method = "POST"): Promise<FakeRes> {
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
    makeReq({ method, url: PASSKEY_OPTIONS_PATH }),
    res.res,
  );
  return res;
}

describe("POST /auth/passkey/options", () => {
  it("rejects non-POST with 405 and allow: POST", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const res = await requestOptions(harness, "GET");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe("method not allowed");
  });

  it("returns the library options JSON plus a scoped opaque ceremony cookie", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const res = await requestOptions(harness);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(res.body) as {
      challenge: string;
      rpId: string;
      timeout: number;
      userVerification: string;
      allowCredentials: unknown[];
    };
    expect(body.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.rpId).toBe(TEST_RP_ID);
    expect(body.timeout).toBe(120_000);
    expect(body.userVerification).toBe("required");
    expect(body.allowCredentials).toEqual([]);
    expect(res.headers["set-cookie"]).toMatch(
      /^dsh_auth_pk=[A-Za-z0-9_-]{43}; Max-Age=120; Path=\/auth; HttpOnly; Secure; SameSite=Lax$/,
    );
    const cookie = res.headers["set-cookie"]!.split(";")[0]!;
    const id = cookie.slice(cookie.indexOf("=") + 1);
    const ceremony = harness.ceremony.consume(id);
    expect(ceremony?.kind).toBe("login");
    expect(Buffer.from(ceremony?.challenge ?? []).toString("base64url")).toBe(body.challenge);
  });

  it("omits Secure from the ceremony cookie when cookieSecure=false", async () => {
    const harness = makePasskeyLoginHarness({ cookieSecure: false });
    registerPasskeyLoginEndpoints(harness.deps);
    const res = await requestOptions(harness);
    expect(res.headers["set-cookie"]).toMatch(
      /^dsh_auth_pk=[A-Za-z0-9_-]{43}; Max-Age=120; Path=\/auth; HttpOnly; SameSite=Lax$/,
    );
  });

  it("answers 429 with a JSON locked body, retry-after and no ceremony cookie", async () => {
    // begin 的配额是独立的 `PasskeyOptionsQuota`（不是登录失败限速器）：耗尽它才 429。
    const harness = makePasskeyLoginHarness({
      optionsQuota: new PasskeyOptionsQuota({ perIpLimit: 1, globalLimit: 100 }),
    });
    registerPasskeyLoginEndpoints(harness.deps);
    expect((await requestOptions(harness)).status).toBe(200);
    const res = await requestOptions(harness);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["permissions-policy"]).toBe(PASSKEY_PERMISSIONS_POLICY);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(JSON.parse(res.body)).toEqual({ error: "locked", retryAfter: 60 });
  });
});
