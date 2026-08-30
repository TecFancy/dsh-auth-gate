import { describe, expect, it } from "vitest";
import {
  assertLoopbackListen,
  bearerOf,
  filterRequestHeaders,
  filterResponseHeaders,
  filterUpgradeResponseHeaders,
  isLoopbackHostname,
  parseListen,
  rewriteSetCookie,
} from "./proxy-headers.js";

describe("isLoopbackHostname", () => {
  it("accepts localhost, IPv6 loopback and 127/8", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.255.9.1")).toBe(true);
  });

  it("rejects non-loopback names and malformed octets", () => {
    expect(isLoopbackHostname("dsh.hi-ruofei.com")).toBe(false);
    expect(isLoopbackHostname("10.0.0.1")).toBe(false);
    expect(isLoopbackHostname("127.300.0.1")).toBe(false);
    expect(isLoopbackHostname("127.0.0")).toBe(false);
    expect(isLoopbackHostname("")).toBe(false);
  });
});

describe("parseListen / assertLoopbackListen", () => {
  it("defaults the port to 8443", () => {
    expect(parseListen("127.0.0.1")).toEqual({ hostname: "127.0.0.1", port: 8443 });
  });

  it("parses host:port and rejects bad ports", () => {
    expect(parseListen("127.0.0.1:9000")).toEqual({ hostname: "127.0.0.1", port: 9000 });
    expect(parseListen("127.0.0.1:0")).toEqual({ hostname: "127.0.0.1", port: 0 });
    expect(() => parseListen("127.0.0.1:-1")).toThrow();
    expect(() => parseListen("127.0.0.1:99999")).toThrow();
    expect(() => parseListen("127.0.0.1:abc")).toThrow();
  });

  it("enforces loopback binding", () => {
    expect(assertLoopbackListen("localhost:8443")).toEqual({ hostname: "localhost", port: 8443 });
    expect(() => assertLoopbackListen("0.0.0.0:8443")).toThrow(/not loopback/);
    expect(() => assertLoopbackListen("eth0:8443")).toThrow(/not loopback/);
  });
});

describe("bearerOf", () => {
  it("extracts a Bearer token case-insensitively", () => {
    expect(bearerOf("Bearer abc123")).toBe("abc123");
    expect(bearerOf("bearer  xyz")).toBe("xyz");
  });

  it("returns undefined for missing or malformed headers", () => {
    expect(bearerOf(undefined)).toBeUndefined();
    expect(bearerOf("Basic abc")).toBeUndefined();
    expect(bearerOf("Bearer")).toBeUndefined();
    expect(bearerOf("")).toBeUndefined();
  });
});

describe("filterRequestHeaders", () => {
  it("drops hop-by-hop headers and host, keeps the rest", () => {
    const out = filterRequestHeaders({
      host: "127.0.0.1:8443",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "transfer-encoding": "chunked",
      cookie: "dsh_auth=1",
      authorization: "Bearer t",
      "content-length": "2",
      "x-dsh-proxy": "0",
    });
    expect(out).toEqual({
      cookie: "dsh_auth=1",
      authorization: "Bearer t",
      "content-length": "2",
      "x-dsh-proxy": "0",
    });
  });

  it("ignores undefined and flattens arrays", () => {
    const out = filterRequestHeaders({ a: undefined, b: ["v1", "v2"], c: "" });
    expect(out).toEqual({ b: "v1, v2" });
  });
});

describe("rewriteSetCookie / filterResponseHeaders", () => {
  it("strips the Secure attribute when strip-secure-cookie is on", () => {
    expect(
      rewriteSetCookie(["dsh_auth=t; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax"]),
    ).toEqual(["dsh_auth=t; Max-Age=60; Path=/; HttpOnly; SameSite=Lax"]);
  });

  it("keeps Secure when stripping is off", () => {
    const out = filterResponseHeaders({ "set-cookie": ["a=1; Secure"] }, false);
    expect(out["set-cookie"]).toEqual(["a=1; Secure"]);
  });

  it("rewrites only the set-cookie response header", () => {
    const out = filterResponseHeaders(
      { "set-cookie": ["a=1; Secure; HttpOnly"], "x-cache": "h" },
      true,
    );
    expect(out["set-cookie"]).toEqual(["a=1; HttpOnly"]);
    expect(out["x-cache"]).toBe("h");
  });

  it("drops hop-by-hop response headers and undefined values", () => {
    const out = filterResponseHeaders(
      { "transfer-encoding": "chunked", age: "1", gone: undefined },
      true,
    );
    expect(out).toEqual({ age: "1" });
  });
});

describe("filterUpgradeResponseHeaders", () => {
  it("keeps upgrade and connection but still drops other hop-by-hop headers", () => {
    const out = filterUpgradeResponseHeaders(
      { upgrade: "websocket", connection: "Upgrade", "transfer-encoding": "chunked", age: "1" },
      false,
    );
    expect(out).toEqual({ upgrade: "websocket", connection: "Upgrade", age: "1" });
  });

  it("adapts set-cookie like filterResponseHeaders", () => {
    const out = filterUpgradeResponseHeaders({ "set-cookie": ["a=1; Secure; HttpOnly"] }, true);
    expect(out["set-cookie"]).toEqual(["a=1; HttpOnly"]);
  });
});
