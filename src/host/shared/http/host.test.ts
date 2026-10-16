import { describe, expect, it } from "vitest";
import { resolvePublicHost } from "./host.js";

describe("resolvePublicHost (D14)", () => {
  it("prefers the configured host over the request header", () => {
    expect(resolvePublicHost("dsh.example.com", "127.0.0.1:3080")).toBe("dsh.example.com");
  });

  it("falls back to the request header when the config is empty or unset", () => {
    expect(resolvePublicHost("", "dsh.example.com")).toBe("dsh.example.com");
    expect(resolvePublicHost(undefined, "dsh.example.com")).toBe("dsh.example.com");
    expect(resolvePublicHost("   ", "dsh.example.com")).toBe("dsh.example.com");
  });

  it("returns an empty string when neither source provides a host", () => {
    expect(resolvePublicHost("", undefined)).toBe("");
    expect(resolvePublicHost(undefined, undefined)).toBe("");
  });

  it("normalises a pasted URL into host[:port]", () => {
    expect(resolvePublicHost("https://dsh.example.com", "127.0.0.1:3080")).toBe("dsh.example.com");
    expect(resolvePublicHost("http://dsh.example.com:8443/", "")).toBe("dsh.example.com:8443");
    expect(resolvePublicHost("  dsh.example.com/path?x=1  ", "")).toBe("dsh.example.com");
  });

  it("keeps a configured host even when the request carries none", () => {
    expect(resolvePublicHost("dsh.example.com", undefined)).toBe("dsh.example.com");
  });

  it("strips userinfo so credentials never reach the card", () => {
    expect(resolvePublicHost("https://alice:s3cret@dsh.example.com/x", "")).toBe("dsh.example.com");
    expect(resolvePublicHost("alice@dsh.example.com", "")).toBe("dsh.example.com");
  });

  it("strips query and fragment without a path", () => {
    expect(resolvePublicHost("dsh.example.com?x=1", "")).toBe("dsh.example.com");
    expect(resolvePublicHost("dsh.example.com#frag", "")).toBe("dsh.example.com");
  });

  it("accepts a protocol-relative value and IPv6 authorities", () => {
    expect(resolvePublicHost("//dsh.example.com", "")).toBe("dsh.example.com");
    expect(resolvePublicHost("[::1]:3080", "")).toBe("[::1]:3080");
    expect(resolvePublicHost("https://[::1]:3080/", "")).toBe("[::1]:3080");
  });

  it("falls back to the request header when normalisation leaves nothing", () => {
    expect(resolvePublicHost("/", "dsh.example.com")).toBe("dsh.example.com");
    expect(resolvePublicHost("https://", "dsh.example.com")).toBe("dsh.example.com");
    expect(resolvePublicHost("//", "dsh.example.com")).toBe("dsh.example.com");
    expect(resolvePublicHost("https://user@", "")).toBe("");
  });
});
