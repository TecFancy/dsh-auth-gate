import { describe, expect, it } from "vitest";
import { wirePasskey, type PasskeyWiringConfig } from "./passkey-wiring.js";

/** 收集日志的假 logger（wirePasskey 只认 error/info）。 */
function makeLog(): {
  entries: { level: "error" | "info"; message: string }[];
  log: { error(message: unknown): void; info(message: unknown): void };
} {
  const entries: { level: "error" | "info"; message: string }[] = [];
  return {
    entries,
    log: {
      error: (message) => entries.push({ level: "error", message: String(message) }),
      info: (message) => entries.push({ level: "info", message: String(message) }),
    },
  };
}

/** 一份 password 模式、配置完整的输入（各用例按需覆盖）。 */
function input(overrides: Partial<PasskeyWiringConfig> = {}): PasskeyWiringConfig {
  return {
    mode: "password",
    publicHost: "https://dsh.example.com",
    totp: "off",
    passkey: "optional",
    passkeyRpName: "DeepSeek Harness",
    passkeyRpId: "",
    passkeyOrigins: [],
    passkeyEnforceCounter: false,
    passkeyConditionalUi: false,
    log: makeLog().log,
    ...overrides,
  };
}

describe("wirePasskey", () => {
  it("returns enabled with derived rpId/origin for a valid https publicHost", () => {
    const result = wirePasskey(input());
    expect(result.enabled).toBe(true);
    expect(result.settings).toMatchObject({
      enabled: true,
      rpId: "dsh.example.com",
      origins: ["https://dsh.example.com"],
    });
  });

  it("stays off and logs nothing when passkey is off", () => {
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ passkey: "off", log }));
    expect(result.enabled).toBe(false);
    expect(entries).toEqual([]);
  });

  it("fails closed with an error when publicHost is missing", () => {
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ publicHost: "", log }));
    expect(result.enabled).toBe(false);
    expect(entries.map((entry) => entry.level)).toEqual(["error"]);
    expect(entries[0]?.message).toContain("public-host-missing");
  });

  it("fails closed with an error for an IP publicHost without passkeyRpId", () => {
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ publicHost: "http://127.0.0.1:3080", log }));
    expect(result.enabled).toBe(false);
    expect(entries[0]?.message).toContain("rp-id-invalid");
  });

  it("logs info (no downgrade) when TOTP is required and passkeys satisfy 2FA", () => {
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ totp: "required", log }));
    expect(result.enabled).toBe(true);
    expect(result.settings.enabled && result.settings.totpSatisfied).toBe(true);
    expect(entries.map((entry) => entry.level)).toEqual(["info"]);
  });

  it("logs an error and stays off in token mode when passkey is not off", () => {
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ mode: "token", log }));
    expect(result.enabled).toBe(false);
    expect(entries.map((entry) => entry.level)).toEqual(["error"]);
    expect(entries[0]?.message).toContain("password-mode only");
  });

  it("stays silent in token mode when passkey is off", () => {
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ mode: "token", passkey: "off", log }));
    expect(result.enabled).toBe(false);
    expect(entries).toEqual([]);
  });
});
