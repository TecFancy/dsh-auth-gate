import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUSTED_PROXIES,
  makeClientIpResolver,
  parseClientIpPolicy,
  resolveClientIp,
  type ClientIpPolicy,
} from "./client-ip.js";
import { cidrContains } from "./ip-address.js";

function reqOf(
  remoteAddress: string | undefined,
  headers: Record<string, string | string[]> = {},
): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

function policyOf(header: string, cidrs?: readonly string[]): ClientIpPolicy {
  return parseClientIpPolicy(header, cidrs ?? DEFAULT_TRUSTED_PROXIES);
}

interface LogEntry {
  level: "error" | "warn";
  message: string;
}

function loggerOf(entries: LogEntry[]): {
  error(message: string): void;
  warn(message: string): void;
} {
  return {
    error: (message) => entries.push({ level: "error", message }),
    warn: (message) => entries.push({ level: "warn", message }),
  };
}

describe("parseClientIpPolicy (D19)", () => {
  it("reads no header at all by default", () => {
    const policy = parseClientIpPolicy("", DEFAULT_TRUSTED_PROXIES);
    expect(policy.header).toBe("");
    expect(policy.degraded).toBeUndefined();
  });

  it("lowercases the configured header name", () => {
    expect(parseClientIpPolicy("X-Forwarded-For", undefined).header).toBe("x-forwarded-for");
    expect(parseClientIpPolicy("  CF-Connecting-IP ", undefined).header).toBe("cf-connecting-ip");
  });

  it("degrades to reading no header when the name is not an HTTP token", () => {
    const policy = parseClientIpPolicy("bad header!: x", undefined);
    expect(policy.header).toBe("");
    expect(policy.degraded).toContain("clientIpHeader");
  });

  it("rejects wildcard trust and degrades to loopback only", () => {
    for (const entry of ["0.0.0.0/0", "::/0", "garbage"]) {
      const policy = parseClientIpPolicy("x-forwarded-for", [entry]);
      expect(policy.degraded).toContain("trustedProxyCidrs");
      expect(policy.trusted).toHaveLength(2);
      expect(cidrContains(policy.trusted[0]!, "127.0.0.1")).toBe(true);
    }
  });

  it("keeps the valid entries and reports the invalid ones", () => {
    const policy = parseClientIpPolicy("cf-connecting-ip", ["10.0.0.0/8", "nope"]);
    expect(policy.trusted).toHaveLength(1);
    expect(cidrContains(policy.trusted[0]!, "10.1.2.3")).toBe(true);
    expect(policy.degraded).toContain("trustedProxyCidrs");
  });

  it("accepts a fully valid configuration without degrading", () => {
    const policy = parseClientIpPolicy("x-real-ip", ["172.17.0.0/16"]);
    expect(policy.header).toBe("x-real-ip");
    expect(policy.degraded).toBeUndefined();
    expect(cidrContains(policy.trusted[0]!, "172.17.0.1")).toBe(true);
  });
});

describe("resolveClientIp (D19)", () => {
  it("uses the normalized socket address when no header is configured", () => {
    expect(resolveClientIp(reqOf("::ffff:9.9.9.9"), undefined)).toEqual({
      ip: "9.9.9.9",
      warning: undefined,
    });
    expect(resolveClientIp(reqOf("127.0.0.1"), policyOf("")).ip).toBe("127.0.0.1");
    expect(resolveClientIp(reqOf(undefined), policyOf("")).ip).toBe("");
  });

  it("ignores a forged header from an untrusted peer", () => {
    const result = resolveClientIp(
      reqOf("203.0.113.7", { "x-forwarded-for": "1.2.3.4" }),
      policyOf("x-forwarded-for"),
    );
    expect(result.ip).toBe("203.0.113.7");
    expect(result.warning?.key).toBe("untrusted-peer");
  });

  it("falls back to the peer when the trusted proxy did not send the header", () => {
    const result = resolveClientIp(reqOf("127.0.0.1"), policyOf("cf-connecting-ip"));
    expect(result.ip).toBe("127.0.0.1");
    expect(result.warning?.key).toBe("header-unusable");
  });
});

describe("resolveClientIp: trusted proxy header (D19)", () => {
  it("keys on the header value when the peer is a trusted proxy", () => {
    const result = resolveClientIp(
      reqOf("::1", { "x-forwarded-for": "8.8.8.8" }),
      policyOf("x-forwarded-for"),
    );
    expect(result).toEqual({ ip: "8.8.8.8", warning: undefined });
  });

  it("takes the rightmost address that is not a trusted hop", () => {
    const policy = policyOf("x-forwarded-for");
    expect(
      resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": "9.9.9.9, 8.8.8.8" }), policy).ip,
    ).toBe("8.8.8.8");
    expect(
      resolveClientIp(
        reqOf("127.0.0.1", { "x-forwarded-for": "1.1.1.1, 8.8.8.8, 127.0.0.1" }),
        policy,
      ).ip,
    ).toBe("8.8.8.8");
    expect(
      resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": "::ffff:8.8.8.8" }), policy).ip,
    ).toBe("8.8.8.8");
    expect(
      resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": ["1.1.1.1", "2.2.2.2"] }), policy).ip,
    ).toBe("2.2.2.2");
    expect(
      resolveClientIp(
        reqOf("127.0.0.1", { "cf-connecting-ip": '"9.9.9.9"' }),
        policyOf("cf-connecting-ip"),
      ).ip,
    ).toBe("9.9.9.9");
  });

  it("falls back when the header carries no usable client address", () => {
    const policy = policyOf("x-forwarded-for");
    for (const value of ["127.0.0.1", "unknown", "1.2.3", `1.1.1.1, ${"9".repeat(300)}`]) {
      const result = resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": value }), policy);
      expect(result.ip).toBe("127.0.0.1");
      expect(result.warning?.key).toBe("header-unusable");
    }
  });

  it("honours a custom trusted proxy network", () => {
    const policy = policyOf("x-real-ip", ["10.0.0.0/8"]);
    expect(resolveClientIp(reqOf("10.1.2.3", { "x-real-ip": "8.8.8.8" }), policy).ip).toBe(
      "8.8.8.8",
    );
    expect(
      resolveClientIp(reqOf("127.0.0.1", { "x-real-ip": "8.8.8.8" }), policy).warning?.key,
    ).toBe("untrusted-peer");
  });

  it("keeps two clients of the same reverse proxy in separate buckets", () => {
    const policy = policyOf("cf-connecting-ip");
    const first = resolveClientIp(
      reqOf("127.0.0.1", { "cf-connecting-ip": "203.0.113.7" }),
      policy,
    ).ip;
    const second = resolveClientIp(
      reqOf("127.0.0.1", { "cf-connecting-ip": "198.51.100.4" }),
      policy,
    ).ip;
    expect(first).not.toBe(second);
  });
});

describe("makeClientIpResolver (D19)", () => {
  it("reports a degraded configuration once, at construction", () => {
    const entries: LogEntry[] = [];
    makeClientIpResolver(parseClientIpPolicy("x-forwarded-for", ["0.0.0.0/0"]), loggerOf(entries));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
    expect(entries[0]?.message).toContain("degraded");
  });

  it("returns the bucket key and warns once per warning class", () => {
    const entries: LogEntry[] = [];
    const resolve = makeClientIpResolver(
      parseClientIpPolicy("x-forwarded-for", ["127.0.0.0/8"]),
      loggerOf(entries),
    );
    expect(resolve(reqOf("203.0.113.7", { "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
    expect(resolve(reqOf("198.51.100.9", { "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.9");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.message).toContain("not a trusted proxy");
    expect(entries[0]?.message).toContain("203.0.113.7");
  });

  it("works without a logger", () => {
    const resolve = makeClientIpResolver(parseClientIpPolicy("x-forwarded-for", undefined));
    expect(resolve(reqOf("127.0.0.1", { "x-forwarded-for": "8.8.8.8" }))).toBe("8.8.8.8");
  });
});
