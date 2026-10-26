import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { makeLaunchTokenBridge, readLaunchToken } from "./launch-token-bridge.js";

/** 只实现 `get` 的假 Context：桥与首次引导都只读 `connection` 这一个服务。 */
function ctxWith(connection: unknown): Context {
  return {
    get: (name: string) => (name === "connection" ? connection : undefined),
  } as unknown as Context;
}

function connections(authenticatedUrl: () => string): unknown {
  return { authenticatedUrl };
}

describe("readLaunchToken", () => {
  it("reads the same token the login bridge hands out", async () => {
    const ctx = ctxWith(connections(() => "http://other.example:9999/deep/path?extra=1&token=abc"));
    const token = readLaunchToken(ctx);
    expect(token).toBe("abc");
    const bridged = await makeLaunchTokenBridge(ctx, { warn: () => undefined })();
    expect(bridged).toBe(`/?token=${encodeURIComponent(token!)}`);
  });

  it("keeps only the token out of the authenticated URL", () => {
    const ctx = ctxWith(connections(() => "https://dsh.example.com:8443/gate?token=a%2Fb%2Bc"));
    expect(readLaunchToken(ctx)).toBe("a/b+c");
  });

  it("returns undefined for every unusable connection shape", () => {
    expect(readLaunchToken(ctxWith(undefined))).toBeUndefined();
    // 旧版 dsh：服务在，但没有 authenticatedUrl。
    expect(readLaunchToken(ctxWith({}))).toBeUndefined();
    expect(readLaunchToken(ctxWith(connections(() => "http://dsh.example.com")))).toBeUndefined();
    expect(
      readLaunchToken(ctxWith(connections(() => "http://dsh.example.com?token="))),
    ).toBeUndefined();
    expect(
      readLaunchToken(
        ctxWith(
          connections(() => {
            throw new Error("connection exploded");
          }),
        ),
      ),
    ).toBeUndefined();
  });
});

describe("makeLaunchTokenBridge", () => {
  it("warns once per process when the bridge is inactive", async () => {
    const warnings: unknown[] = [];
    const bridge = makeLaunchTokenBridge(ctxWith(undefined), { warn: (m) => warnings.push(m) });
    expect(await bridge()).toBeUndefined();
    expect(await bridge()).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain("launch-token bridge inactive");
  });

  it("warns once per process when authenticatedUrl yields no token", async () => {
    const warnings: unknown[] = [];
    const bridge = makeLaunchTokenBridge(ctxWith(connections(() => "http://h")), {
      warn: (m) => warnings.push(m),
    });
    expect(await bridge()).toBeUndefined();
    expect(await bridge()).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain("returned no token");
  });

  it("warns once per process and stays silent for successful reads", async () => {
    const warnings: unknown[] = [];
    let explode = true;
    const bridge = makeLaunchTokenBridge(
      ctxWith(
        connections(() => {
          if (explode) throw new Error("boom");
          return "http://h/?token=abc";
        }),
      ),
      { warn: (m) => warnings.push(m) },
    );
    expect(await bridge()).toBeUndefined();
    explode = false;
    expect(await bridge()).toBe("/?token=abc");
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain("boom");
  });
});
