import { describe, expect, it } from "vitest";
import { cidrContains, normalizeIp, parseCidr, type CidrNetwork } from "./ip-address.js";

function cidr(text: string): CidrNetwork {
  const network = parseCidr(text);
  if (network === undefined) throw new Error(`test fixture is not a CIDR: ${text}`);
  return network;
}

describe("normalizeIp (D19)", () => {
  it("keeps dotted quads and strips decorations", () => {
    expect(normalizeIp("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp(" 1.2.3.4 ")).toBe("1.2.3.4");
    expect(normalizeIp("1.2.3.4:8080")).toBe("1.2.3.4");
    expect(normalizeIp("[::1]:8080")).toBe("::1");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
  });

  it("folds IPv4-mapped IPv6 into the dotted form so both spellings share one bucket", () => {
    expect(normalizeIp("::ffff:8.8.8.8")).toBe("8.8.8.8");
    expect(normalizeIp("::ffff:808:808")).toBe("8.8.8.8");
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("prints IPv6 in one canonical form", () => {
    expect(normalizeIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(normalizeIp("2001:db8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeIp("::")).toBe("::");
    expect(normalizeIp("0:0:0:0:0:0:0:1")).toBe("::1");
  });

  it("returns empty for anything that is not an IP literal", () => {
    expect(normalizeIp("")).toBe("");
    expect(normalizeIp(undefined)).toBe("");
    expect(normalizeIp("unknown")).toBe("");
    expect(normalizeIp("256.1.1.1")).toBe("");
    expect(normalizeIp("1.2.3")).toBe("");
    expect(normalizeIp("1.2.3.4.5")).toBe("");
    expect(normalizeIp("01.2.3.4")).toBe("");
    expect(normalizeIp("2001:db8:::1")).toBe("");
    expect(normalizeIp("1:2:3:4:5:6:7")).toBe("");
  });
});

describe("parseCidr (D19)", () => {
  it("parses IPv4 and IPv6 networks", () => {
    expect(parseCidr("127.0.0.0/8")).toEqual({ bytes: [127, 0, 0, 0], prefix: 8 });
    expect(parseCidr("::1/128")?.bytes).toHaveLength(16);
    expect(parseCidr("::/0")?.prefix).toBe(0);
  });

  it("rejects malformed input", () => {
    expect(parseCidr("10.0.0.0")).toBeUndefined();
    expect(parseCidr("10.0.0.0/33")).toBeUndefined();
    expect(parseCidr("10.0.0.0/x")).toBeUndefined();
    expect(parseCidr("garbage/8")).toBeUndefined();
    expect(parseCidr("")).toBeUndefined();
  });
});

describe("cidrContains (D19)", () => {
  it("matches inside the prefix and not outside", () => {
    const loopback = cidr("127.0.0.0/8");
    expect(cidrContains(loopback, "127.0.0.1")).toBe(true);
    expect(cidrContains(loopback, "127.255.255.254")).toBe(true);
    expect(cidrContains(loopback, "128.0.0.1")).toBe(false);
    expect(cidrContains(loopback, "::1")).toBe(false);
  });

  it("sees IPv4-mapped addresses as their IPv4 form", () => {
    expect(cidrContains(cidr("127.0.0.0/8"), "::ffff:127.0.0.1")).toBe(true);
    expect(cidrContains(cidr("::1/128"), "::1")).toBe(true);
    expect(cidrContains(cidr("::1/128"), "::2")).toBe(false);
  });

  it("masks partial bytes and wildcard networks", () => {
    expect(cidrContains(cidr("192.168.1.0/24"), "192.168.1.255")).toBe(true);
    expect(cidrContains(cidr("192.168.1.0/24"), "192.168.2.0")).toBe(false);
    expect(cidrContains(cidr("10.0.0.1/8"), "10.255.255.255")).toBe(true);
    expect(cidrContains(cidr("0.0.0.0/0"), "8.8.8.8")).toBe(true);
  });

  it("never matches a non-literal or a different address family", () => {
    expect(cidrContains(cidr("127.0.0.0/8"), "not-an-ip")).toBe(false);
    expect(cidrContains(cidr("127.0.0.0/8"), "")).toBe(false);
  });
});
