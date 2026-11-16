/**
 * `/auth/status` 的两个配置透传位：`passkeyEnabled` 与 `passwordLoginDisabled`。
 *
 * 两者**正交**：`passkey: "required"` 而 WebAuthn 配置写坏时，前者是 `false`、后者仍是 `true`
 * （实例进入谁都进不来的状态）。这一层钉住「两个键恒在、值原样透传、缺省为 false」。
 */
import { describe, expect, it } from "vitest";
import type { UsersLoadResult } from "../../user/@x/session.js";
import { makeDeps, status, usersOf } from "../../../../../test/session-status-harness.js";

const ALICE = { passwordHash: "h", disabled: false };

describe("handleStatus: passkeyEnabled", () => {
  it("is always present and false by default, in both auth states", async () => {
    for (const cookie of ["dsh_auth=good", "dsh_auth=bad"]) {
      const res = await status(makeDeps(), cookie);
      expect(res.json()).toHaveProperty("passkeyEnabled", false);
    }
  });

  it("echoes the configured flag in both auth states", async () => {
    const deps = makeDeps({ passkeyEnabled: true, loadUsers: usersOf({ alice: ALICE }) });
    const authed = await status(deps, "dsh_auth=good");
    expect(authed.json()).toMatchObject({ authenticated: true, passkeyEnabled: true });
    const anonymous = await status(deps, "dsh_auth=bad");
    expect(anonymous.json()).toMatchObject({ authenticated: false, passkeyEnabled: true });
  });

  it("stays present in the fallback shape when users are unreadable", async () => {
    const loadUsers = (): Promise<UsersLoadResult> => Promise.reject(new Error("boom"));
    const res = await status(makeDeps({ passkeyEnabled: true, loadUsers }), "dsh_auth=good");
    expect(res.json()).toEqual({
      authenticated: true,
      logoutOrder: 42,
      passkeyEnabled: true,
      passwordLoginDisabled: false,
    });
  });
});

describe("handleStatus: passwordLoginDisabled", () => {
  it("defaults to false when the deps omit it", async () => {
    const res = await status(makeDeps(), "dsh_auth=good");
    expect(res.json()).toHaveProperty("passwordLoginDisabled", false);
  });

  it("echoes the configured flag in both auth states", async () => {
    const deps = makeDeps({ passwordLoginDisabled: true, loadUsers: usersOf({ alice: ALICE }) });
    const authed = await status(deps, "dsh_auth=good");
    expect(authed.json()).toMatchObject({ authenticated: true, passwordLoginDisabled: true });
    const anonymous = await status(deps, "dsh_auth=bad");
    expect(anonymous.json()).toMatchObject({ authenticated: false, passwordLoginDisabled: true });
  });

  it("is orthogonal to passkeyEnabled (broken WebAuthn keeps the password closed)", async () => {
    // issue #133 第 4 点：配置写坏时 passkeyEnabled 为 false，但口令登录仍然关闭。
    const deps = makeDeps({ passkeyEnabled: false, passwordLoginDisabled: true });
    const res = await status(deps, "dsh_auth=good");
    expect(res.json()).toMatchObject({
      passkeyEnabled: false,
      passwordLoginDisabled: true,
    });
  });
});
