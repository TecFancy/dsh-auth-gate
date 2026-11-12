import { describe, expect, it } from "vitest";
import { PASSKEY_SETTINGS_PATH } from "../../../shared/protocol/index.js";
import { registerPasskeyEndpoints } from "./passkey-endpoints.js";
import {
  formBody,
  makeManagementRes,
  managementRequest,
} from "../../../../../test/passkey-management-http-harness.js";
import {
  makeManagementHarness,
  makeUser,
  managementHandler,
  type ManagementHarness,
} from "../../../../../test/passkey-management-harness.js";

function mount(harness: ManagementHarness): void {
  registerPasskeyEndpoints(harness.deps);
}

async function send(
  harness: ManagementHarness,
  path: string,
  options: {
    method?: string;
    cookie?: string;
    fields?: Record<string, string>;
  } = {},
): Promise<ReturnType<typeof makeManagementRes>> {
  const res = makeManagementRes();
  await managementHandler(harness.routes, path)(
    managementRequest({
      method: options.method ?? "POST",
      url: path,
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.fields === undefined ? {} : { body: formBody(options.fields) }),
    }),
    res.res,
  );
  return res;
}

describe("passkey settings", () => {
  it("returns the current conditional UI value for an admin", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("root", makeUser({ role: "admin" }));
    const cookie = await harness.issueSessionCookie("root");
    const res = await send(harness, PASSKEY_SETTINGS_PATH, { method: "GET", cookie });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ conditionalUiEnabled: false });
  });

  it("answers 403 for a non-admin and for a restricted session", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("alice", makeUser());
    const cookie = await harness.issueSessionCookie("alice");
    expect((await send(harness, PASSKEY_SETTINGS_PATH, { method: "GET", cookie })).status).toBe(
      403,
    );
    harness.users.set("root", makeUser({ role: "admin" }));
    const restricted = await harness.issueSessionCookie("root", "password-change-only");
    expect(
      (await send(harness, PASSKEY_SETTINGS_PATH, { method: "GET", cookie: restricted })).status,
    ).toBe(403);
  });

  it("toggles the switch and persists it", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("root", makeUser({ role: "admin" }));
    const cookie = await harness.issueSessionCookie("root");
    const on = await send(harness, PASSKEY_SETTINGS_PATH, {
      cookie,
      fields: { conditionalUi: "1" },
    });
    expect(on.status).toBe(200);
    expect(JSON.parse(on.body)).toEqual({ conditionalUiEnabled: true });
    expect(harness.persisted).toEqual([{ enabled: true }]);
    expect(harness.conditionalUi()).toBe(true);
    const off = await send(harness, PASSKEY_SETTINGS_PATH, {
      cookie,
      fields: { conditionalUi: "0" },
    });
    expect(JSON.parse(off.body)).toEqual({ conditionalUiEnabled: false });
    expect(harness.conditionalUi()).toBe(false);
  });

  it("rejects an invalid value with 400 and still answers 200 when persistence fails", async () => {
    const harness = makeManagementHarness();
    mount(harness);
    harness.users.set("root", makeUser({ role: "admin" }));
    const cookie = await harness.issueSessionCookie("root");
    for (const value of ["true", "on", "", "2"]) {
      const res = await send(harness, PASSKEY_SETTINGS_PATH, {
        cookie,
        fields: { conditionalUi: value },
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({
        error: "bad_request",
        reason: "invalid-conditional-ui",
      });
    }
    harness.setPersistFailure(true);
    const failed = await send(harness, PASSKEY_SETTINGS_PATH, {
      cookie,
      fields: { conditionalUi: "1" },
    });
    expect(failed.status).toBe(200);
    expect(JSON.parse(failed.body)).toEqual({ conditionalUiEnabled: true });
    expect(harness.logs).toContainEqual({
      level: "error",
      message: "passkey settings: persist failed: settings service unavailable",
    });
  });
});
