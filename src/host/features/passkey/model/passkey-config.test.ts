import { describe, expect, it } from "vitest";
import {
  resolvePasskeySettings,
  type PasskeyDisabledReason,
  type PasskeySettings,
  type PasskeySettingsInput,
} from "./passkey-config.js";

const BASE: PasskeySettingsInput = {
  passkey: "optional",
  publicHost: "https://dsh.example.com",
  passkeyRpName: "DeepSeek Harness",
  passkeyRpId: "",
  passkeyOrigins: [],
  passkeyEnforceCounter: false,
  passkeyConditionalUi: false,
  totp: "off",
};

type EnabledSettings = Extract<PasskeySettings, { enabled: true }>;

function input(overrides: Partial<PasskeySettingsInput> = {}): PasskeySettingsInput {
  return { ...BASE, ...overrides };
}

function enabledSettings(overrides: Partial<PasskeySettingsInput> = {}): EnabledSettings {
  const settings = resolvePasskeySettings(input(overrides));
  if (!settings.enabled) throw new Error(`expected enabled, got: ${settings.reason}`);
  return settings;
}

function disabledReason(
  overrides: Partial<PasskeySettingsInput> = {},
): PasskeyDisabledReason | undefined {
  const settings = resolvePasskeySettings(input(overrides));
  return settings.enabled ? undefined : settings.reason;
}

const DISABLED_CASES: readonly (readonly [
  string,
  Partial<PasskeySettingsInput>,
  PasskeyDisabledReason,
])[] = [
  ["off wins over every other field", { passkey: "off", publicHost: "" }, "off"],
  ["empty publicHost", { publicHost: "" }, "public-host-missing"],
  ["whitespace-only publicHost", { publicHost: "   " }, "public-host-missing"],
  ["unparsable publicHost", { publicHost: "https://" }, "public-host-invalid"],
  ["publicHost with a path", { publicHost: "https://dsh.example.com/auth" }, "public-host-invalid"],
  ["publicHost with a query", { publicHost: "https://dsh.example.com?x=1" }, "public-host-invalid"],
  [
    "publicHost with a fragment",
    { publicHost: "https://dsh.example.com#x" },
    "public-host-invalid",
  ],
  [
    "publicHost with credentials",
    { publicHost: "https://user:pass@dsh.example.com" },
    "public-host-invalid",
  ],
  ["non-http(s) publicHost", { publicHost: "ftp://dsh.example.com" }, "public-host-invalid"],
  ["IPv4 publicHost without an rpId", { publicHost: "https://192.168.1.10" }, "rp-id-invalid"],
  [
    "IPv4 loopback publicHost without an rpId",
    { publicHost: "http://127.0.0.1:3080" },
    "rp-id-invalid",
  ],
  ["IPv6 publicHost without an rpId", { publicHost: "https://[::1]:8443" }, "rp-id-invalid"],
  ["rpId with a scheme", { passkeyRpId: "https://dsh.example.com" }, "rp-id-invalid"],
  ["rpId with a port", { passkeyRpId: "dsh.example.com:8443" }, "rp-id-invalid"],
  ["rpId with a path", { passkeyRpId: "dsh.example.com/auth" }, "rp-id-invalid"],
  ["single-label rpId other than localhost", { passkeyRpId: "intranet" }, "rp-id-invalid"],
  [
    "http origin on a non-localhost host",
    { passkeyOrigins: ["http://dsh.example.com"] },
    "origin-invalid",
  ],
  [
    "origin outside the rpId suffix",
    { passkeyOrigins: ["https://evil.example.net"] },
    "origin-invalid",
  ],
  ["relative origin", { passkeyOrigins: ["dsh.example.com"] }, "origin-invalid"],
  ["origin with a path", { passkeyOrigins: ["https://dsh.example.com/auth"] }, "origin-invalid"],
  [
    "origin merely containing the rpId as a substring",
    { passkeyOrigins: ["https://evildsh.example.com"] },
    "origin-invalid",
  ],
];

describe("resolvePasskeySettings: disabled reasons", () => {
  for (const [name, overrides, reason] of DISABLED_CASES) {
    it(name, () => {
      expect(disabledReason(overrides)).toBe(reason);
    });
  }

  it("returns only enabled+reason when disabled", () => {
    expect(resolvePasskeySettings(input({ publicHost: "" }))).toEqual({
      enabled: false,
      reason: "public-host-missing",
    });
  });
});

const ENABLED_CASES: readonly (readonly [
  string,
  Partial<PasskeySettingsInput>,
  string,
  string[],
])[] = [
  ["https publicHost derives rpId and origin", {}, "dsh.example.com", ["https://dsh.example.com"]],
  [
    "scheme-less publicHost is parsed as https",
    { publicHost: "dsh.example.com" },
    "dsh.example.com",
    ["https://dsh.example.com"],
  ],
  [
    "trailing slash is dropped",
    { publicHost: "https://dsh.example.com/" },
    "dsh.example.com",
    ["https://dsh.example.com"],
  ],
  [
    "scheme and host are lowercased",
    { publicHost: "HTTPS://DSH.Example.COM" },
    "dsh.example.com",
    ["https://dsh.example.com"],
  ],
  [
    "explicit port is kept in the origin but not in the rpId",
    { publicHost: "https://dsh.example.com:8443" },
    "dsh.example.com",
    ["https://dsh.example.com:8443"],
  ],
  [
    "scheme-less publicHost keeps a non-default port",
    { publicHost: "dsh.example.com:8443" },
    "dsh.example.com",
    ["https://dsh.example.com:8443"],
  ],
  [
    "explicit parent-domain rpId accepts the publicHost subdomain",
    { passkeyRpId: "example.com" },
    "example.com",
    ["https://dsh.example.com"],
  ],
  [
    "explicit rpId is lowercased",
    { publicHost: "https://auth.example.com", passkeyRpId: "AUTH.Example.COM" },
    "auth.example.com",
    ["https://auth.example.com"],
  ],
  [
    "http is allowed for localhost",
    { publicHost: "http://localhost:5173" },
    "localhost",
    ["http://localhost:5173"],
  ],
  [
    "scheme-less localhost defaults to https",
    { publicHost: "localhost:5173" },
    "localhost",
    ["https://localhost:5173"],
  ],
  [
    "multiple explicit origins under the rpId are kept in order",
    {
      passkeyOrigins: ["https://dsh.example.com", "https://dsh-test.example.com:8443"],
      passkeyRpId: "example.com",
    },
    "example.com",
    ["https://dsh.example.com", "https://dsh-test.example.com:8443"],
  ],
  [
    "explicit origin is canonicalized",
    { passkeyOrigins: ["HTTPS://DSH.Example.COM:443/"] },
    "dsh.example.com",
    ["https://dsh.example.com"],
  ],
];

describe("resolvePasskeySettings: enabled derivation", () => {
  for (const [name, overrides, rpId, origins] of ENABLED_CASES) {
    it(name, () => {
      const settings = enabledSettings(overrides);
      expect(settings.rpId).toBe(rpId);
      expect(settings.origins).toEqual(origins);
    });
  }

  it("passes rpName and policy flags through", () => {
    const settings = enabledSettings({
      passkeyRpName: "Acme DSH",
      passkeyEnforceCounter: true,
      passkeyConditionalUi: true,
    });

    expect(settings.rpName).toBe("Acme DSH");
    expect(settings.enforceCounter).toBe(true);
    expect(settings.conditionalUi).toBe(true);
    expect(settings.totpSatisfied).toBe(false);
  });

  it("marks TOTP satisfied for optional and required (warning only, never downgraded)", () => {
    expect(enabledSettings({ totp: "optional" }).totpSatisfied).toBe(true);
    expect(enabledSettings({ totp: "required" }).totpSatisfied).toBe(true);
  });

  it("does not mutate or alias the configured origin list", () => {
    const origins = ["https://dsh.example.com"];
    const settings = enabledSettings({ passkeyOrigins: origins });

    expect(origins).toEqual(["https://dsh.example.com"]);
    expect(settings.origins).not.toBe(origins);
  });
});
