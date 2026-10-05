import { describe, expect, it } from "vitest";
import { resolvePostLoginLocation } from "./login-redirect.js";

/** 收集 warn 文案（helper 只依赖 `warn` 一个方法）。 */
function collector(): { messages: string[]; logger: { warn(message: unknown): void } } {
  const messages: string[] = [];
  return { messages, logger: { warn: (message) => messages.push(String(message)) } };
}

describe("resolvePostLoginLocation: the bridge may only change the target, never fail the login", () => {
  it("returns next untouched when no bridge is configured", async () => {
    const { messages, logger } = collector();
    expect(await resolvePostLoginLocation(undefined, "/ok", logger)).toBe("/ok");
    expect(messages).toEqual([]);
  });

  it("takes a safe relative location from the bridge", async () => {
    const { messages, logger } = collector();
    const bridge = () => Promise.resolve("/?token=launch");
    expect(await resolvePostLoginLocation(bridge, "/ok", logger)).toBe("/?token=launch");
    expect(messages).toEqual([]);
  });

  it("falls back silently when the bridge reports itself unavailable", async () => {
    const { messages, logger } = collector();
    const bridge = () => Promise.resolve(undefined);
    expect(await resolvePostLoginLocation(bridge, "/ok", logger)).toBe("/ok");
    // 桥自己已经按闩告警过（inactive/unavailable），这里不重复刷屏。
    expect(messages).toEqual([]);
  });

  it("rejects every unsafe location shape with a warning", async () => {
    for (const unsafe of ["", "//evil.com", "http://evil.com/", "/\\evil.com", "/\t/evil.com"]) {
      const { messages, logger } = collector();
      const bridge = () => Promise.resolve(unsafe);
      expect(await resolvePostLoginLocation(bridge, "/ok", logger)).toBe("/ok");
      expect(messages).toEqual([
        "launch-token bridge returned an unsafe location; falling back to plain redirect",
      ]);
    }
  });

  it("falls back when the bridge throws", async () => {
    const { messages, logger } = collector();
    const bridge = () => Promise.reject(new Error("connection gone"));
    expect(await resolvePostLoginLocation(bridge, "/ok", logger)).toBe("/ok");
    expect(messages).toEqual(["launch-token bridge failed; falling back to plain redirect"]);
  });

  it("survives a logger that is missing or throws", async () => {
    const bridge = () => Promise.reject(new Error("connection gone"));
    expect(await resolvePostLoginLocation(bridge, "/ok", {})).toBe("/ok");
    const throwing = {
      warn: () => {
        throw new Error("log sink gone");
      },
    };
    expect(await resolvePostLoginLocation(bridge, "/ok", throwing)).toBe("/ok");
    const unsafe = () => Promise.resolve("//evil.com");
    expect(await resolvePostLoginLocation(unsafe, "/ok", throwing)).toBe("/ok");
  });
});
