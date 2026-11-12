import { describe, expect, it } from "vitest";
import type { ServerResponse } from "node:http";
import { PASSKEY_PERMISSIONS_POLICY, setPasskeyPermissionsPolicy } from "./permissions-policy.js";

/** 只记录 setHeader 的假响应。 */
function makeRes(): { res: ServerResponse; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string): void {
      headers[name.toLowerCase()] = value;
    },
  } as unknown as ServerResponse;
  return { res, headers };
}

describe("Permissions-Policy for WebAuthn", () => {
  it("allows the same origin and denies cross-origin frames", () => {
    // `=()` 会把顶层文档自己也禁掉（navigator.credentials 抛 NotAllowedError），
    // 所以必须是 `=(self)`：同源可用、跨源 iframe 拿不到。
    expect(PASSKEY_PERMISSIONS_POLICY).toBe(
      "publickey-credentials-get=(self), publickey-credentials-create=(self)",
    );
    expect(PASSKEY_PERMISSIONS_POLICY).not.toContain("=()");
  });

  it("sets the header before writeHead", () => {
    const { res, headers } = makeRes();
    setPasskeyPermissionsPolicy(res);
    expect(headers["permissions-policy"]).toBe(PASSKEY_PERMISSIONS_POLICY);
  });
});
