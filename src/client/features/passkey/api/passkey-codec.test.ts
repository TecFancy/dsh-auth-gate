/**
 * passkey 的浏览器侧编解码（M6 PR3）：base64url 往返、options JSON → publicKey、
 * transports 提取、特性检测。纯函数，不需要 DOM（jsdom 只提供 `atob`/`btoa`）。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeBase64Url,
  encodeBase64Url,
  isCancelled,
  isPasskeySupported,
  toCreationOptions,
  transportsOf,
} from "./passkey-codec.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `BufferSource` → 字节数组（DOM 类型里 id/challenge 是 BufferSource，测试要逐字节断言）。 */
function bytesOf(value: BufferSource): number[] {
  const view = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer);
  return [...view];
}

describe("base64url", () => {
  it("round-trips arbitrary bytes without padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = encodeBase64Url(bytes.buffer);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect([...new Uint8Array(decodeBase64Url(encoded))]).toEqual([...bytes]);
  });

  it("decodes unpadded input and standard base64 alike", () => {
    expect([...new Uint8Array(decodeBase64Url("AQID"))]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(decodeBase64Url("AQI="))]).toEqual([1, 2]);
    expect([...new Uint8Array(decodeBase64Url("-_8"))]).toEqual([251, 255]);
  });
});

describe("toCreationOptions", () => {
  const OPTIONS = {
    challenge: "AQID",
    rp: { id: "dsh.example.com", name: "DeepSeek Harness" },
    user: { id: "BAUG", name: "alice", displayName: "Alice" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 60000,
    excludeCredentials: [{ type: "public-key", id: "BwgJ", transports: ["internal"] }],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
  };

  it("converts every base64url field to an ArrayBuffer", () => {
    const publicKey = toCreationOptions(OPTIONS);
    expect(publicKey).toBeDefined();
    expect(bytesOf(publicKey!.challenge)).toEqual([1, 2, 3]);
    expect(bytesOf(publicKey!.user.id)).toEqual([4, 5, 6]);
    expect(publicKey!.rp).toEqual({ id: "dsh.example.com", name: "DeepSeek Harness" });
    expect(publicKey!.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(publicKey!.timeout).toBe(60000);
    expect(publicKey!.attestation).toBe("none");
    expect(publicKey!.authenticatorSelection).toEqual({
      residentKey: "required",
      userVerification: "required",
    });
    expect(bytesOf(publicKey!.excludeCredentials![0]!.id)).toEqual([7, 8, 9]);
    expect(publicKey!.excludeCredentials![0]!.transports).toEqual(["internal"]);
  });

  it("omits optional fields that the server did not send", () => {
    const publicKey = toCreationOptions({
      challenge: "AQID",
      rp: { name: "RP" },
      user: { id: "BAUG", name: "alice", displayName: "Alice" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    });
    expect(publicKey).toBeDefined();
    expect(publicKey!.rp.id).toBeUndefined();
    expect(publicKey!.timeout).toBeUndefined();
    expect(publicKey!.excludeCredentials).toBeUndefined();
    expect(publicKey!.attestation).toBeUndefined();
  });

  it("rejects shapes that are not creation options", () => {
    expect(toCreationOptions(null)).toBeUndefined();
    expect(toCreationOptions({})).toBeUndefined();
    expect(toCreationOptions({ challenge: "AQID" })).toBeUndefined();
    expect(
      toCreationOptions({ challenge: "AQID", rp: {}, user: {}, pubKeyCredParams: [] }),
    ).toBeUndefined();
  });
});

describe("transportsOf", () => {
  it("joins the authenticator transports with commas", () => {
    const credential = {
      response: { getTransports: () => ["internal", "hybrid"] },
    } as unknown as PublicKeyCredential;
    expect(transportsOf(credential)).toBe("internal,hybrid");
  });

  it("returns an empty string when the browser does not report transports", () => {
    const credential = { response: {} } as unknown as PublicKeyCredential;
    expect(transportsOf(credential)).toBe("");
  });
});

describe("isPasskeySupported", () => {
  it("is false when PublicKeyCredential is missing", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(isPasskeySupported()).toBe(false);
  });

  it("is true when both PublicKeyCredential and credentials.create exist", () => {
    vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
    // jsdom 没有 WebAuthn：`navigator.credentials` 需要自己补上（只测特性检测这一层）。
    Object.defineProperty(globalThis.navigator, "credentials", {
      configurable: true,
      value: { create: () => Promise.resolve(null) },
    });
    expect(isPasskeySupported()).toBe(true);
    Reflect.deleteProperty(globalThis.navigator, "credentials");
  });
});

describe("isCancelled", () => {
  it("treats AbortError and NotAllowedError as user cancellation", () => {
    expect(isCancelled({ name: "AbortError" })).toBe(true);
    expect(isCancelled({ name: "NotAllowedError" })).toBe(true);
    expect(isCancelled({ name: "InvalidStateError" })).toBe(false);
    expect(isCancelled(null)).toBe(false);
  });
});
