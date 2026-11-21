import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOKEN_MIN_LENGTH, makeTokenResolver } from "./token-resolver.js";

interface Credentials {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
}

function ctxWith(credentials: Credentials | undefined): Context {
  return {
    get(name: string): unknown {
      return name === "credentials" ? credentials : undefined;
    },
  } as unknown as Context;
}

function recorder(): { log: { error(message: unknown): void }; errors: string[] } {
  const errors: string[] = [];
  return { errors, log: { error: (message) => errors.push(String(message)) } };
}

const LONG = "x".repeat(DEFAULT_TOKEN_MIN_LENGTH);

describe("makeTokenResolver: entropy floor (L4)", () => {
  it("returns a token at or above the floor unchanged", async () => {
    const { log } = recorder();
    const resolve = makeTokenResolver(
      ctxWith({ resolve: () => Promise.resolve({ value: LONG, source: "test" }) }),
      { tokenRef: "DSH_AUTH_TOKEN" },
      log,
    );
    await expect(resolve()).resolves.toBe(LONG);
  });

  it("treats a token shorter than the floor as unavailable and logs it once", async () => {
    const { log, errors } = recorder();
    const resolve = makeTokenResolver(
      ctxWith({ resolve: () => Promise.resolve({ value: "x".repeat(31), source: "test" }) }),
      { tokenRef: "DSH_AUTH_TOKEN" },
      log,
    );
    await expect(resolve()).resolves.toBeUndefined();
    await expect(resolve()).resolves.toBeUndefined();
    expect(
      errors.filter((message) => message.includes("shorter than tokenMinLength")),
    ).toHaveLength(1);
  });

  it("honours a custom, higher floor from config", async () => {
    const { log } = recorder();
    const resolve = makeTokenResolver(
      ctxWith({ resolve: () => Promise.resolve({ value: LONG, source: "test" }) }),
      { tokenRef: "DSH_AUTH_TOKEN", tokenMinLength: LONG.length + 1 },
      log,
    );
    await expect(resolve()).resolves.toBeUndefined();
  });

  it("recovers after the token is replaced, and can warn again on a later regression", async () => {
    const { log, errors } = recorder();
    let value = "x".repeat(8);
    const resolve = makeTokenResolver(
      ctxWith({ resolve: () => Promise.resolve({ value, source: "test" }) }),
      { tokenRef: "DSH_AUTH_TOKEN" },
      log,
    );
    await expect(resolve()).resolves.toBeUndefined();
    value = LONG;
    await expect(resolve()).resolves.toBe(LONG);
    value = "y".repeat(8);
    await expect(resolve()).resolves.toBeUndefined();
    expect(
      errors.filter((message) => message.includes("shorter than tokenMinLength")),
    ).toHaveLength(2);
  });
});

describe("makeTokenResolver: service failures stay fail-closed", () => {
  it("returns undefined and logs once when the credentials service is missing", async () => {
    const { log, errors } = recorder();
    const resolve = makeTokenResolver(ctxWith(undefined), { tokenRef: "DSH_AUTH_TOKEN" }, log);
    await expect(resolve()).resolves.toBeUndefined();
    await expect(resolve()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("credentials service is unavailable");
  });

  it("returns undefined and logs when resolution throws", async () => {
    const { log, errors } = recorder();
    const resolve = makeTokenResolver(
      ctxWith({ resolve: () => Promise.reject(new Error("boom")) }),
      { tokenRef: "DSH_AUTH_TOKEN" },
      log,
    );
    await expect(resolve()).resolves.toBeUndefined();
    expect(errors[0]).toContain("token resolution failed");
    expect(errors[0]).toContain("boom");
  });
});
