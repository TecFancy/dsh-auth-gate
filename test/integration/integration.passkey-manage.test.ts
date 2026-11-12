import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PasskeyAttestationAuthenticator } from "../passkey-attestation-harness.js";
import {
  mountManageStack,
  passwordLogin,
  RP_ID,
  sameOrigin,
  TEST_PASSWORD,
  unmountStack,
  type ManageStack,
} from "./integration-passkey-manage-helpers.js";

/** 注册 begin：返回 challenge 与 ceremony cookie。 */
async function beginRegistration(
  stack: ManageStack,
  sessionCookie: string,
  label: string,
): Promise<{ challenge: string; cookie: string }> {
  const res = await fetch(`${stack.base}/auth/passkey/register/options`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: sessionCookie,
      ...sameOrigin(stack.origin),
    },
    body: new URLSearchParams({ label, password: TEST_PASSWORD, code: "" }).toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { challenge: string };
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toMatch(/^dsh_auth_pk=/);
  return { challenge: body.challenge, cookie: cookie! };
}

describe("integration: passkey registration and management over a real HTTP stack", () => {
  it("registers a passkey, lists it, then removes it", async () => {
    const stack = await mountManageStack();
    try {
      const sessionCookie = await passwordLogin(stack.base, "alice");
      const authenticator = new PasskeyAttestationAuthenticator({ rpId: RP_ID });
      const begin = await beginRegistration(stack, sessionCookie, "My key");
      const attestation = authenticator.attest({
        challenge: begin.challenge,
        origin: stack.origin,
      });
      const register = await fetch(`${stack.base}/auth/passkey/register`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${sessionCookie}; ${begin.cookie}`,
          ...sameOrigin(stack.origin),
        },
        body: new URLSearchParams({
          id: attestation.id,
          client_data_json: attestation.client_data_json,
          attestation_object: attestation.attestation_object,
          transports: "internal,hybrid",
        }).toString(),
        redirect: "manual",
      });
      expect(register.status).toBe(200);
      const registered = (await register.json()) as {
        ok: boolean;
        passkey: { idPrefix: string; label: string; transports: string[] };
      };
      expect(registered.ok).toBe(true);
      expect(registered.passkey).toMatchObject({
        idPrefix: authenticator.credentialId.slice(0, 12),
        label: "My key",
        transports: ["internal", "hybrid"],
      });

      // 落盘断言：users.yaml 里出现该凭据，且不含明文口令。
      const yaml = readFileSync(stack.usersFile, "utf8");
      expect(yaml).toContain(authenticator.credentialId);
      expect(yaml).toContain(authenticator.publicKeyCose);
      expect(yaml).toContain("passkeyUserHandle");
      expect(yaml).not.toContain(TEST_PASSWORD);

      const list = await fetch(`${stack.base}/auth/passkey`, {
        headers: { cookie: sessionCookie, ...sameOrigin(stack.origin) },
      });
      expect(list.status).toBe(200);
      const listed = (await list.json()) as { passkeys: { idPrefix: string }[] };
      expect(listed.passkeys).toHaveLength(1);
      expect(listed.passkeys[0]!.idPrefix).toBe(authenticator.credentialId.slice(0, 12));
    } finally {
      await unmountStack(stack);
    }
  });
});

describe("integration: passkey removal over a real HTTP stack", () => {
  it("removes the registered passkey and leaves an empty list", async () => {
    const stack = await mountManageStack();
    try {
      const sessionCookie = await passwordLogin(stack.base, "alice");
      const authenticator = new PasskeyAttestationAuthenticator({ rpId: RP_ID });
      const begin = await beginRegistration(stack, sessionCookie, "My key");
      const attestation = authenticator.attest({
        challenge: begin.challenge,
        origin: stack.origin,
      });
      await fetch(`${stack.base}/auth/passkey/register`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${sessionCookie}; ${begin.cookie}`,
          ...sameOrigin(stack.origin),
        },
        body: new URLSearchParams({
          id: attestation.id,
          client_data_json: attestation.client_data_json,
          attestation_object: attestation.attestation_object,
          transports: "internal",
        }).toString(),
        redirect: "manual",
      });
      const remove = await fetch(`${stack.base}/auth/passkey/remove`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: sessionCookie,
          ...sameOrigin(stack.origin),
        },
        body: new URLSearchParams({
          id: authenticator.credentialId.slice(0, 8),
          password: TEST_PASSWORD,
          code: "",
        }).toString(),
        redirect: "manual",
      });
      expect(remove.status).toBe(200);
      expect(await remove.json()).toEqual({ ok: true, removed: 1 });
      const empty = await fetch(`${stack.base}/auth/passkey`, {
        headers: { cookie: sessionCookie, ...sameOrigin(stack.origin) },
      });
      expect(await empty.json()).toEqual({ passkeys: [] });
    } finally {
      await unmountStack(stack);
    }
  });
});

describe("integration: passkey management rejections", () => {
  it("rejects registration without re-authentication and cross-origin writes", async () => {
    const stack = await mountManageStack();
    try {
      const sessionCookie = await passwordLogin(stack.base, "alice");
      const wrongPassword = await fetch(`${stack.base}/auth/passkey/register/options`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: sessionCookie,
          ...sameOrigin(stack.origin),
        },
        body: new URLSearchParams({ label: "Key", password: "nope", code: "" }).toString(),
        redirect: "manual",
      });
      expect(wrongPassword.status).toBe(401);

      const crossOrigin = await fetch(`${stack.base}/auth/passkey/register/options`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: sessionCookie,
          origin: "https://evil.example",
        },
        body: new URLSearchParams({ label: "Key", password: TEST_PASSWORD }).toString(),
        redirect: "manual",
      });
      expect(crossOrigin.status).toBe(403);

      // 同源但无会话 → 401（Origin 门在 401 之前，所以必须带同源头才走到会话判定）。
      const anonymous = await fetch(`${stack.base}/auth/passkey`, {
        headers: sameOrigin(stack.origin),
        redirect: "manual",
      });
      expect(anonymous.status).toBe(401);
      // 读路径不做同源校验（地址栏导航不带 Origin）：无 cookie 仍是 401。
      const noOrigin = await fetch(`${stack.base}/auth/passkey`, { redirect: "manual" });
      expect(noOrigin.status).toBe(401);
    } finally {
      await unmountStack(stack);
    }
  });

  it("toggles the conditional UI switch as an admin", async () => {
    const stack = await mountManageStack();
    try {
      const adminCookie = await passwordLogin(stack.base, "root");
      const before = await fetch(`${stack.base}/auth/passkey/settings`, {
        headers: { cookie: adminCookie, ...sameOrigin(stack.origin) },
      });
      expect(await before.json()).toEqual({ conditionalUiEnabled: false });
      const toggle = await fetch(`${stack.base}/auth/passkey/settings`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie,
          ...sameOrigin(stack.origin),
        },
        body: new URLSearchParams({ conditionalUi: "1" }).toString(),
        redirect: "manual",
      });
      expect(toggle.status).toBe(200);
      expect(await toggle.json()).toEqual({ conditionalUiEnabled: true });
      const after = await fetch(`${stack.base}/auth/passkey/settings`, {
        headers: { cookie: adminCookie, ...sameOrigin(stack.origin) },
      });
      expect(await after.json()).toEqual({ conditionalUiEnabled: true });

      const userCookie = await passwordLogin(stack.base, "alice");
      const forbidden = await fetch(`${stack.base}/auth/passkey/settings`, {
        headers: { cookie: userCookie, ...sameOrigin(stack.origin) },
      });
      expect(forbidden.status).toBe(403);
    } finally {
      await unmountStack(stack);
    }
  });
});
