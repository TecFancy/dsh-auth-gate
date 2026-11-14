import { describe, expect, it } from "vitest";
import type { PasskeyRecord, UsersSnapshot } from "../../../entities/user/index.js";
import {
  PasskeyCounterStore,
  backupStateMatches,
  findPasskeyCredential,
  readAuthenticatorCounter,
  readPasskeyAssertion,
  selectVerificationCounter,
} from "./passkey-login.js";

const ALICE_HANDLE = Buffer.alloc(32, 7).toString("base64url");

function record(overrides: Partial<PasskeyRecord> = {}): PasskeyRecord {
  return {
    credentialId: Buffer.from([1, 2, 3, 4]).toString("base64url"),
    publicKeyCose: Buffer.from([5, 6, 7]).toString("base64url"),
    alg: -7,
    signCount: 0,
    aaguid: "",
    be: false,
    bs: false,
    uvInitialized: true,
    transports: ["internal"],
    label: "Test key",
    createdAt: 1,
    lastUsedAt: 0,
    ...overrides,
  };
}

function snapshot(username: string, overrides: Partial<PasskeyRecord> = {}): UsersSnapshot {
  return {
    users: new Map([
      [
        username,
        {
          passwordHash: "scrypt$placeholder",
          disabled: false,
          passkeyUserHandle: ALICE_HANDLE,
          passkeys: [record(overrides)],
        },
      ],
    ]),
  };
}

function paramsOf(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

const ASSERTION_FIELDS = {
  id: "AQIDBA",
  client_data_json: "e30",
  authenticator_data: Buffer.alloc(37).toString("base64url"),
  signature: "MEUCIQ",
};

describe("readPasskeyAssertion", () => {
  it("reads the four required fields plus an optional user_handle", () => {
    expect(readPasskeyAssertion(paramsOf(ASSERTION_FIELDS))).toEqual({
      id: ASSERTION_FIELDS.id,
      clientDataJSON: ASSERTION_FIELDS.client_data_json,
      authenticatorData: ASSERTION_FIELDS.authenticator_data,
      signature: ASSERTION_FIELDS.signature,
      userHandle: undefined,
    });
    expect(
      readPasskeyAssertion(paramsOf({ ...ASSERTION_FIELDS, user_handle: "BwkJ" }))?.userHandle,
    ).toBe("BwkJ");
  });

  it("rejects missing, empty, oversized or non-base64url fields", () => {
    for (const missing of ["id", "client_data_json", "authenticator_data", "signature"]) {
      const fields: Record<string, string> = { ...ASSERTION_FIELDS };
      delete fields[missing];
      expect(readPasskeyAssertion(paramsOf(fields))).toBeUndefined();
    }
    expect(readPasskeyAssertion(paramsOf({ ...ASSERTION_FIELDS, id: "" }))).toBeUndefined();
    expect(readPasskeyAssertion(paramsOf({ ...ASSERTION_FIELDS, id: "a/b" }))).toBeUndefined();
    expect(
      readPasskeyAssertion(paramsOf({ ...ASSERTION_FIELDS, signature: "a".repeat(16 * 1024 + 1) })),
    ).toBeUndefined();
    expect(
      readPasskeyAssertion(paramsOf({ ...ASSERTION_FIELDS, user_handle: "not base64url" })),
    ).toBeUndefined();
  });
});

describe("findPasskeyCredential", () => {
  it("finds the credential across all users (no username input at login)", () => {
    const credentialId = record().credentialId;
    const found = findPasskeyCredential(snapshot("alice"), credentialId);
    expect(found?.username).toBe("alice");
    expect(found?.record.credentialId).toBe(credentialId);
  });

  it("returns undefined for unknown credentials and users without passkeys", () => {
    expect(findPasskeyCredential(snapshot("alice"), "bm90LWZvdW5k")).toBeUndefined();
    expect(
      findPasskeyCredential(
        {
          users: new Map([["bob", { passwordHash: "x", disabled: false }]]),
        },
        record().credentialId,
      ),
    ).toBeUndefined();
  });
});

describe("readAuthenticatorCounter", () => {
  it("reads the big-endian counter at offset 33", () => {
    const authData = Buffer.alloc(37);
    authData.writeUInt32BE(7, 33);
    expect(readAuthenticatorCounter(authData.toString("base64url"))).toBe(7);
  });

  it("returns undefined when authenticatorData is too short", () => {
    expect(readAuthenticatorCounter(Buffer.alloc(36).toString("base64url"))).toBeUndefined();
  });
});

describe("selectVerificationCounter", () => {
  const base = { enforce: false, deviceBound: false };
  it("skips the counter check when either side reports 0", () => {
    expect(selectVerificationCounter({ ...base, stored: 5, reported: 0 }).counter).toBe(0);
    expect(selectVerificationCounter({ ...base, stored: 0, reported: 3 }).counter).toBe(0);
    expect(selectVerificationCounter({ ...base, stored: 5, reported: undefined }).counter).toBe(0);
  });

  it("passes the stored counter to the library when the counter advanced", () => {
    expect(selectVerificationCounter({ ...base, stored: 5, reported: 6 }).counter).toBe(5);
  });

  it("rejects a regression only for device-bound credentials with enforcement on", () => {
    expect(
      selectVerificationCounter({ enforce: true, deviceBound: true, stored: 5, reported: 3 }),
    ).toMatchObject({ rejection: "counter-regression", warn: undefined });
    expect(
      selectVerificationCounter({ enforce: true, deviceBound: false, stored: 5, reported: 3 }),
    ).toMatchObject({ counter: 0, rejection: undefined, warn: "counter-regression" });
    expect(
      selectVerificationCounter({ enforce: false, deviceBound: true, stored: 5, reported: 3 }),
    ).toMatchObject({ counter: 0, warn: "counter-regression" });
  });

  it("passes equal counters to the library, which treats them as replay", () => {
    expect(selectVerificationCounter({ ...base, stored: 5, reported: 5 }).counter).toBe(5);
  });
});

describe("backupStateMatches", () => {
  it("requires both BE and BS to match the registered record", () => {
    expect(backupStateMatches(record(), "singleDevice", false)).toBe(true);
    expect(backupStateMatches(record(), "multiDevice", false)).toBe(false);
    expect(backupStateMatches(record(), "singleDevice", true)).toBe(false);
    expect(backupStateMatches(record({ be: true, bs: true }), "multiDevice", true)).toBe(true);
  });
});

describe("PasskeyCounterStore", () => {
  it("falls back to the snapshot counter and only advances", () => {
    const store = new PasskeyCounterStore();
    const passkey = record({ signCount: 5 });
    expect(store.stored(passkey)).toBe(5);
    expect(store.advance(passkey, 6)).toBe(6);
    expect(store.stored(passkey)).toBe(6);
    expect(store.advance(passkey, 2)).toBe(6);
    expect(store.stored(passkey)).toBe(6);
  });
});
