import { describe, expect, it } from "vitest";
import { PASSKEY_LOGIN_PATH, PASSKEY_OPTIONS_PATH } from "../../../shared/protocol/index.js";
import { CeremonyStore } from "../model/ceremony-store.js";
import { makeReq, makeRes, type FakeRes } from "../../../../../test/token-endpoints-harness.js";
import {
  PasskeyAuthenticator,
  makePasskeyLoginHarness,
  randomBase64Url,
  routeHandler,
  TEST_CLIENT_IP,
  TEST_ORIGIN,
  TEST_RP_ID,
  type PasskeyAssertionForm,
  type PasskeyLoginHarness,
} from "../../../../../test/passkey-authenticator-harness.js";
import {
  PASSKEY_LOGIN_FAILED_MESSAGE,
  PASSKEY_LOGIN_LOCKED_MESSAGE,
} from "./passkey-login-failures.js";
import { registerPasskeyLoginEndpoints } from "./passkey-login-endpoints.js";

interface OpenedCeremony {
  readonly challenge: string;
  readonly cookie: string;
  readonly id: string;
}

async function begin(harness: PasskeyLoginHarness): Promise<OpenedCeremony> {
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_OPTIONS_PATH)(
    makeReq({ method: "POST", url: PASSKEY_OPTIONS_PATH }),
    res.res,
  );
  const body = JSON.parse(res.body) as { challenge: string };
  const cookie = res.headers["set-cookie"]!.split(";")[0]!;
  return { challenge: body.challenge, cookie, id: cookie.slice(cookie.indexOf("=") + 1) };
}

async function post(
  harness: PasskeyLoginHarness,
  fields: PasskeyAssertionForm,
  cookie?: string,
): Promise<FakeRes> {
  const params = new URLSearchParams();
  params.set("id", fields.id);
  params.set("client_data_json", fields.client_data_json);
  params.set("authenticator_data", fields.authenticator_data);
  params.set("signature", fields.signature);
  if (fields.user_handle !== undefined) params.set("user_handle", fields.user_handle);
  const res = makeRes();
  await routeHandler(harness.routes, PASSKEY_LOGIN_PATH)(
    makeReq({
      method: "POST",
      url: PASSKEY_LOGIN_PATH,
      contentType: "application/x-www-form-urlencoded",
      body: Buffer.from(params.toString()),
      ...(cookie === undefined ? {} : { cookie }),
    }),
    res.res,
  );
  return res;
}

function expectRejected(res: FakeRes): void {
  expect(res.status).toBe(401);
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
  expect(res.body).toContain(PASSKEY_LOGIN_FAILED_MESSAGE);
  expect(res.headers["set-cookie"]).toContain("dsh_auth_pk=; Max-Age=0");
}

function freshAuthenticator(): PasskeyAuthenticator {
  return new PasskeyAuthenticator({ rpId: TEST_RP_ID, userHandle: randomBase64Url(32) });
}

describe("POST /auth/passkey/login: transport failures", () => {
  it("rejects non-POST with 405 and allow: POST", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    for (const method of ["GET", "PUT"]) {
      const res = makeRes();
      await routeHandler(harness.routes, PASSKEY_LOGIN_PATH)(
        makeReq({ method, url: PASSKEY_LOGIN_PATH }),
        res.res,
      );
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("POST");
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("answers 415 for a non-urlencoded body and 413 for an oversized one", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const handler = routeHandler(harness.routes, PASSKEY_LOGIN_PATH);
    const wrongType = makeRes();
    await handler(
      makeReq({
        method: "POST",
        url: PASSKEY_LOGIN_PATH,
        contentType: "application/json",
        body: Buffer.from("{}"),
      }),
      wrongType.res,
    );
    expect(wrongType.status).toBe(415);
    expect(wrongType.headers["cache-control"]).toBe("no-store");
    const tooBig = makeRes();
    await handler(
      makeReq({
        method: "POST",
        url: PASSKEY_LOGIN_PATH,
        contentType: "application/x-www-form-urlencoded",
        body: Buffer.alloc(16 * 1024 + 1, 0x61),
      }),
      tooBig.res,
    );
    expect(tooBig.status).toBe(413);
    expect(tooBig.headers["connection"]).toBe("close");
  });
});

describe("POST /auth/passkey/login: ceremony and store preconditions", () => {
  it("answers 429 with the fixed lockout card before consuming the ceremony", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const opened = await begin(harness);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      harness.limiter.recordFailure(TEST_CLIENT_IP, undefined);
    }
    const res = await post(
      harness,
      freshAuthenticator().assert({ challenge: opened.challenge, origin: TEST_ORIGIN }),
      opened.cookie,
    );
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.body).toContain(PASSKEY_LOGIN_LOCKED_MESSAGE);
    expect(harness.ceremony.consume(opened.id)).toBeDefined();
  });

  it("answers 503 before consuming the ceremony when the session store is not ready", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const opened = await begin(harness);
    harness.setSessionsAvailable(false);
    const res = await post(
      harness,
      freshAuthenticator().assert({ challenge: opened.challenge, origin: TEST_ORIGIN }),
      opened.cookie,
    );
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toBe("text/plain");
    expect(res.body).toBe("session store unavailable");
    expect(harness.ceremony.consume(opened.id)).toBeDefined();
  });
});

describe("POST /auth/passkey/login: ceremony failures", () => {
  it("answers 401 for a missing, expired or wrong-kind ceremony", async () => {
    let now = 1_000;
    const harness = makePasskeyLoginHarness({
      ceremony: new CeremonyStore({ ttlMs: 1_000, now: () => now }),
    });
    registerPasskeyLoginEndpoints(harness.deps);
    const authenticator = freshAuthenticator();
    expectRejected(
      await post(harness, authenticator.assert({ challenge: "AA", origin: TEST_ORIGIN })),
    );
    const expired = await begin(harness);
    now += 2_000;
    expectRejected(
      await post(
        harness,
        authenticator.assert({ challenge: expired.challenge, origin: TEST_ORIGIN }),
        expired.cookie,
      ),
    );
    const register = harness.ceremony.create({ kind: "register" });
    const wrongKind = await post(
      harness,
      authenticator.assert({
        challenge: Buffer.from(register.challenge).toString("base64url"),
        origin: TEST_ORIGIN,
      }),
      `dsh_auth_pk=${register.id}`,
    );
    expectRejected(wrongKind);
    expect(harness.logs).toContainEqual({
      level: "warn",
      message: "passkey login rejected: ceremony missing or expired",
    });
  });

  it("answers 401 for a malformed assertion and consumes the ceremony", async () => {
    const harness = makePasskeyLoginHarness();
    registerPasskeyLoginEndpoints(harness.deps);
    const opened = await begin(harness);
    const fields = freshAuthenticator().assert({
      challenge: opened.challenge,
      origin: TEST_ORIGIN,
    });
    const res = await post(harness, { ...fields, signature: "" }, opened.cookie);
    expectRejected(res);
    expect(harness.ceremony.consume(opened.id)).toBeUndefined();
    expect(harness.logs).toContainEqual({
      level: "warn",
      message: "passkey login rejected: malformed assertion",
    });
  });
});
