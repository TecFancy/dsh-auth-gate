import { describe, expect, it } from "vitest";
import { parseAccountStatus } from "./account-status.ts";

/**
 * 解析器直测：`/auth/status` 的线上形状 → 视图对象。
 *
 * `passkeyEnabled` 线上恒在（新服务端），但旧服务端没有该键：守卫必须把「缺键」与「非法值」
 * 都留成 `undefined`（不知道），只有真正的布尔才进视图。
 */
describe("parseAccountStatus: passkeyEnabled", () => {
  it("keeps true and false as sent by a new server", () => {
    expect(parseAccountStatus({ authenticated: true, passkeyEnabled: true }).passkeyEnabled).toBe(
      true,
    );
    expect(parseAccountStatus({ authenticated: true, passkeyEnabled: false }).passkeyEnabled).toBe(
      false,
    );
  });

  it("leaves it undefined for an old server that omits the key", () => {
    expect(parseAccountStatus({ authenticated: true }).passkeyEnabled).toBeUndefined();
  });

  it("leaves it undefined for a non-boolean value", () => {
    for (const value of ["true", 1, null, {}]) {
      expect(
        parseAccountStatus({ authenticated: true, passkeyEnabled: value }).passkeyEnabled,
      ).toBeUndefined();
    }
  });
});
