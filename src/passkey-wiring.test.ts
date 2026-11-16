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
    passkeyConditionalUi: { get: () => false },
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

  it("unwraps the volatile conditional-UI box into the derived settings", () => {
    // 盒子里的 true 必须真的走到派生结果里：漏了 `.get()` 的话这里会拿到盒子对象本身。
    const result = wirePasskey(input({ passkeyConditionalUi: { get: () => true } }));
    expect(result.settings).toMatchObject({ enabled: true, conditionalUi: true });
    expect(result.login).toEqual({ enabled: true, conditionalUi: true });
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

describe("wirePasskey: passkey-only (required)", () => {
  it("enables the feature and disables password login", () => {
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ passkey: "required", log }));
    expect(result.enabled).toBe(true);
    expect(result.passwordLoginDisabled).toBe(true);
    expect(entries.map((entry) => entry.level)).toEqual(["info"]);
    expect(entries[0]?.message).toContain("password sign-in is disabled");
  });

  it("keeps password login disabled when the WebAuthn configuration is unusable", () => {
    // issue #133 第 4 点：配置写坏不得自动恢复在线口令登录。
    const { entries, log } = makeLog();
    const result = wirePasskey(input({ passkey: "required", publicHost: "", log }));
    expect(result.enabled).toBe(false);
    expect(result.passwordLoginDisabled).toBe(true);
    expect(result.login).toBeUndefined();
    expect(entries.map((entry) => entry.level)).toEqual(["error", "error"]);
    expect(entries[1]?.message).toContain("nobody can sign in");
  });

  it("does not disable password login in optional mode", () => {
    const result = wirePasskey(input({ passkey: "optional" }));
    expect(result.passwordLoginDisabled).toBe(false);
  });

  it("does not disable password login in token mode (there is none)", () => {
    const result = wirePasskey(input({ mode: "token", passkey: "required" }));
    expect(result.passwordLoginDisabled).toBe(false);
  });
});
