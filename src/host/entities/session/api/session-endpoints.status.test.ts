import { describe, expect, it } from "vitest";
import type { UsersLoadResult } from "../../user/@x/session.js";
import {
  makeDeps,
  makeRes,
  session,
  status,
  statusReq,
  storeWith,
  usersOf,
  type UserRecord,
} from "../../../../../test/session-status-harness.js";
import { handleStatus } from "./session-endpoints.js";

const ALICE: UserRecord = { passwordHash: "h", disabled: false };

describe("handleStatus: method gate", () => {
  it("rejects non-GET with 405 Allow: GET", () => {
    for (const method of ["POST", "HEAD", "PUT"]) {
      const res = makeRes();
      const result = handleStatus(makeDeps(), statusReq("dsh_auth=good", method), res.res);
      expect(result).toBeUndefined();
      expect(res.status()).toBe(405);
      expect(res.headers["allow"]).toBe("GET");
    }
  });
});

describe("handleStatus: session check (token mode, no loadUsers)", () => {
  it("reports an authenticated cookie session with the base fields only", async () => {
    const res = await status(makeDeps(), "x=1; dsh_auth=good");
    expect(res.status()).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({
      authenticated: true,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
    });
  });

  it("reports unauthenticated for a missing, empty, foreign or unknown cookie", async () => {
    for (const cookie of [undefined, "dsh_auth=", "other=good", "dsh_auth=bad"]) {
      const res = await status(makeDeps(), cookie);
      expect(res.status()).toBe(200);
      expect(res.json()).toEqual({
        authenticated: false,
        logoutOrder: 42,
        passkeyEnabled: false,
        passwordLoginDisabled: false,
      });
    }
  });

  it("reports unauthenticated when the session channel is unavailable", async () => {
    const res = await status(makeDeps({ store: undefined }), "dsh_auth=good");
    expect(res.json()).toEqual({
      authenticated: false,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
    });
  });

  it("answers synchronously when it does not read users", () => {
    const res = makeRes();
    expect(handleStatus(makeDeps(), statusReq("dsh_auth=good"), res.res)).toBeUndefined();
    expect(res.status()).toBe(200);
  });
});

describe("handleStatus: identity fields (password mode)", () => {
  it("never reads users for an unauthenticated request", async () => {
    let reads = 0;
    const loadUsers = (): Promise<UsersLoadResult> => {
      reads += 1;
      return usersOf({ alice: ALICE })();
    };
    const res = await status(makeDeps({ loadUsers }), "dsh_auth=bad");
    expect(res.json()).toEqual({
      authenticated: false,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
    });
    expect(reads).toBe(0);
  });

  it("fills defaults for a plain user on a legacy session row", async () => {
    const res = await status(makeDeps({ loadUsers: usersOf({ alice: ALICE }) }), "dsh_auth=good");
    expect(res.json()).toEqual({
      authenticated: true,
      name: "alice",
      role: "user",
      disabled: false,
      totpEnabled: false,
      mustChangePassword: false,
      sessionKind: "full",
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
    });
  });

  it("projects role, totp, must-change and session kind as stored", async () => {
    const store = storeWith({ good: session({ kind: "password-change-only" }) });
    const admin: UserRecord = {
      passwordHash: "h",
      disabled: true,
      role: "admin",
      totpSecret: "JBSWY3DPEHPK3PXP",
      mustChangePassword: true,
    };
    const res = await status(
      makeDeps({ store, loadUsers: usersOf({ alice: admin }) }),
      "dsh_auth=good",
    );
    expect(res.json()).toMatchObject({
      role: "admin",
      disabled: true,
      totpEnabled: true,
      mustChangePassword: true,
      sessionKind: "password-change-only",
    });
  });

  it("exposes only the caller's own record, never other users", async () => {
    const loadUsers = usersOf({ alice: ALICE, bob: { ...ALICE, role: "admin" } });
    const body = JSON.stringify((await status(makeDeps({ loadUsers }), "dsh_auth=good")).json());
    expect(body).not.toContain("bob");
    expect(body).not.toContain("admin");
  });

  it("keeps the base fields when the subject is no longer in users", async () => {
    const res = await status(makeDeps({ loadUsers: usersOf({ bob: ALICE }) }), "dsh_auth=good");
    expect(res.json()).toEqual({
      authenticated: true,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
    });
  });
});

describe("handleStatus: users file unavailable", () => {
  it("keeps the base fields and logs the error message", async () => {
    const errors: unknown[] = [];
    const loadUsers = (): Promise<UsersLoadResult> => Promise.reject(new Error("bad yaml"));
    const res = await status(makeDeps({ loadUsers, errors }), "dsh_auth=good");
    expect(res.status()).toBe(200);
    expect(res.json()).toEqual({
      authenticated: true,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
    });
    expect(errors).toEqual(["status: users file unavailable: bad yaml"]);
  });

  it("stringifies a non-Error rejection", async () => {
    const errors: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- 被测分支就是非 Error 拒因
    const loadUsers = (): Promise<UsersLoadResult> => Promise.reject("EACCES");
    await status(makeDeps({ loadUsers, errors }), "dsh_auth=good");
    expect(errors).toEqual(["status: users file unavailable: EACCES"]);
  });

  it("tolerates a logger without error()", async () => {
    const loadUsers = (): Promise<UsersLoadResult> => Promise.reject(new Error("gone"));
    const res = await status(makeDeps({ loadUsers }), "dsh_auth=good");
    expect(res.json()).toEqual({
      authenticated: true,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
    });
  });
});
