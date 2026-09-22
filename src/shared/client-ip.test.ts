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
  return cidrs === undefined
    ? parseClientIpPolicy(header, DEFAULT_TRUSTED_PROXIES)
    : parseClientIpPolicy(header, cidrs);
}

function trustsLoopback(policy: ClientIpPolicy): boolean {
  return policy.trusted.some((network) => cidrContains(network, "127.0.0.1"));
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

  it("lowercases and accepts the configured header name", () => {
    expect(parseClientIpPolicy("X-Forwarded-For", undefined).header).toBe("x-forwarded-for");
    expect(parseClientIpPolicy("  CF-Connecting-IP ", undefined).header).toBe("cf-connecting-ip");
    expect(parseClientIpPolicy("x_forwarded_for", undefined).header).toBe("x_forwarded_for");
  });

  it("degrades to reading no header when the name is not an HTTP token", () => {
    const policy = parseClientIpPolicy("bad header!: x", undefined);
    expect(policy.header).toBe("");
    expect(policy.degraded).toBeDefined();
  });

  it("rejects wildcard trust and degrades to loopback only", () => {
    for (const entry of ["0.0.0.0/0", "::/0", "8.8.8.8/0", "garbage"]) {
      const policy = parseClientIpPolicy("x-forwarded-for", [entry]);
      expect(policy.degraded).toBeDefined();
      expect(trustsLoopback(policy)).toBe(true);
    }
  });

  it("keeps the valid entries and reports the invalid ones", () => {
    const policy = parseClientIpPolicy("cf-connecting-ip", ["10.0.0.0/8", "nope"]);
    expect(policy.trusted.some((network) => cidrContains(network, "10.1.2.3"))).toBe(true);
    expect(policy.degraded).toBeDefined();
  });

  it("accepts a fully valid configuration without degrading", () => {
    const policy = parseClientIpPolicy("x-real-ip", ["172.17.0.0/16"]);
    expect(policy.header).toBe("x-real-ip");
    expect(policy.degraded).toBeUndefined();
    expect(policy.trusted.some((network) => cidrContains(network, "172.17.0.1"))).toBe(true);
  });

  it("treats an omitted list as the loopback default and an empty list as trust nobody", () => {
    const omitted = parseClientIpPolicy("x-forwarded-for", undefined);
    expect(trustsLoopback(omitted)).toBe(true);
    expect(omitted.degraded).toBeUndefined();
    const empty = parseClientIpPolicy("x-forwarded-for", []);
    expect(empty.trusted).toHaveLength(0);
    expect(empty.degraded).toBeUndefined();
  });
});

describe("resolveClientIp: no header configured (D19)", () => {
  it("uses the normalized socket address", () => {
    expect(resolveClientIp(reqOf("::ffff:9.9.9.9"), undefined)).toEqual({
      ip: "9.9.9.9",
      warning: undefined,
    });
    expect(resolveClientIp(reqOf("127.0.0.1"), policyOf("")).ip).toBe("127.0.0.1");
    expect(resolveClientIp(reqOf(undefined), policyOf("")).ip).toBe("");
  });

  it("never reads the header when the trusted set is explicitly empty", () => {
    const policy = parseClientIpPolicy("x-forwarded-for", []);
    const result = resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": "8.8.8.8" }), policy);
    expect(result).toEqual({ ip: "127.0.0.1", warning: undefined });
  });
});

describe("resolveClientIp: untrusted peer (D19)", () => {
  it("ignores a forged header", () => {
    const result = resolveClientIp(
      reqOf("203.0.113.7", { "x-forwarded-for": "1.2.3.4" }),
      policyOf("x-forwarded-for"),
    );
    expect(result.ip).toBe("203.0.113.7");
    expect(result.warning?.key).toContain("untrusted-peer");
  });

  it("honours a custom trusted proxy network", () => {
    const policy = policyOf("x-real-ip", ["10.0.0.0/8"]);
    expect(resolveClientIp(reqOf("10.1.2.3", { "x-real-ip": "8.8.8.8" }), policy).ip).toBe(
      "8.8.8.8",
    );
    expect(
      resolveClientIp(reqOf("127.0.0.1", { "x-real-ip": "8.8.8.8" }), policy).warning,
    ).toBeDefined();
  });
});

describe("resolveClientIp: trusted peer (D19)", () => {
  it("keys on the header value, including loopback spellings and Unix sockets", () => {
    const policy = policyOf("x-forwarded-for");
    expect(resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": "8.8.8.8" }), policy).ip).toBe(
      "8.8.8.8",
    );
    expect(
      resolveClientIp(reqOf("::ffff:127.0.0.1", { "x-forwarded-for": "8.8.8.8" }), policy).ip,
    ).toBe("8.8.8.8");
    expect(resolveClientIp(reqOf("::1", { "x-forwarded-for": "8.8.8.8" }), policy).ip).toBe(
      "8.8.8.8",
    );
    // 非 TCP（Unix socket）没有对端地址：只可能来自本机，按本机信任处理
    expect(resolveClientIp(reqOf(undefined, { "x-forwarded-for": "8.8.8.8" }), policy).ip).toBe(
      "8.8.8.8",
    );
  });

  it("takes the rightmost address that is not a trusted hop", () => {
    const policy = policyOf("x-forwarded-for");
    const address = (value: string | string[]): string =>
      resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": value }), policy).ip;
    expect(address("9.9.9.9, 8.8.8.8")).toBe("8.8.8.8");
    expect(address("1.1.1.1, 8.8.8.8, 127.0.0.1")).toBe("8.8.8.8");
    expect(address("::ffff:8.8.8.8")).toBe("8.8.8.8");
    expect(address(["1.1.1.1", "2.2.2.2"])).toBe("2.2.2.2");
    expect(
      resolveClientIp(
        reqOf("127.0.0.1", { "cf-connecting-ip": '"9.9.9.9"' }),
        policyOf("cf-connecting-ip"),
      ).ip,
    ).toBe("9.9.9.9");
  });

  it("handles a long but valid chain", () => {
    const chain = Array.from({ length: 20 }, (_, index) => `2001:db8::${index + 1}`);
    const value = `${chain.join(", ")}, 8.8.8.8`;
    expect(value.length).toBeGreaterThan(256);
    expect(
      resolveClientIp(reqOf("127.0.0.1", { "x-forwarded-for": value }), policyOf("x-forwarded-for"))
        .ip,
    ).toBe("8.8.8.8");
  });
});

describe("resolveClientIp: unusable headers (D19)", () => {
  it("falls back to the peer, and never shifts left onto a forged value", () => {
    const policy = policyOf("x-forwarded-for");
    const cases = [
      undefined,
      "",
      "127.0.0.1",
      "unknown",
      "1.2.3",
      "1.1.1.1, ",
      "1.1.1.1, unknown",
      "1.1.1.1, 1.2.3.4garbage",
      `1.1.1.1, ${"9".repeat(300)}`,
    ];
    for (const value of cases) {
      const headers = value === undefined ? {} : { "x-forwarded-for": value };
      const result = resolveClientIp(reqOf("127.0.0.1", headers), policy);
      expect(result.ip).toBe("127.0.0.1");
      expect(result.warning?.key).toBe("header-unusable");
    }
  });
});

describe("makeClientIpResolver (D19)", () => {
  it("reports a degraded configuration once, at construction", () => {
    const entries: LogEntry[] = [];
    makeClientIpResolver(parseClientIpPolicy("x-forwarded-for", ["0.0.0.0/0"]), loggerOf(entries));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
  });

  it("returns the bucket key and warns once per untrusted peer", () => {
    const entries: LogEntry[] = [];
    const resolve = makeClientIpResolver(
      parseClientIpPolicy("x-forwarded-for", ["127.0.0.0/8"]),
      loggerOf(entries),
    );
    expect(resolve(reqOf("203.0.113.7", { "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
    expect(resolve(reqOf("203.0.113.7", { "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
    expect(resolve(reqOf("198.51.100.9", { "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.9");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.message).toContain("not a trusted proxy");
  });

  it("caps the number of warnings and works without a logger", () => {
    const entries: LogEntry[] = [];
    const resolve = makeClientIpResolver(
      parseClientIpPolicy("x-forwarded-for", undefined),
      loggerOf(entries),
    );
    for (let index = 0; index < 40; index += 1) {
      resolve(reqOf(`203.0.113.${index}`, { "x-forwarded-for": "1.2.3.4" }));
    }
    expect(entries).toHaveLength(10);
    expect(
      makeClientIpResolver(parseClientIpPolicy("x-forwarded-for", undefined))(
        reqOf("127.0.0.1", { "x-forwarded-for": "8.8.8.8" }),
      ),
    ).toBe("8.8.8.8");
  });
});
