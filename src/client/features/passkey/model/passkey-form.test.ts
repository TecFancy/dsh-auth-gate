/**
 * passkey 表单的纯逻辑（M6 PR3）：本地校验闭表与失败映射。
 *
 * 这一层不碰 DOM、不发请求：只钉住「哪些输入被拦下」与「哪个状态码翻成哪句文案」。
 */
import { describe, expect, it } from "vitest";
import { PASSKEY_DICT_EN, PASSKEY_KEYS, translateFrom } from "../../../shared/i18n/index.ts";
import {
  describePasskeyFailure,
  EMPTY_PASSKEY_FORM,
  isInvalidTotp,
  PASSKEY_LABEL_MAX,
  validatePasskeyForm,
} from "./passkey-form.ts";

const t = translateFrom(PASSKEY_DICT_EN);

describe("validatePasskeyForm", () => {
  it("accepts a filled form and treats the code as optional", () => {
    expect(validatePasskeyForm({ label: "MacBook", password: "pw", code: "" }, t)).toBeNull();
  });

  it("requires a non-blank label (trimmed)", () => {
    const failure = validatePasskeyForm({ ...EMPTY_PASSKEY_FORM, label: "   ", password: "pw" }, t);
    expect(failure).toEqual({ message: t(PASSKEY_KEYS.labelRequired), fields: ["label"] });
  });

  it("rejects a label longer than 64 characters", () => {
    const failure = validatePasskeyForm(
      { label: "x".repeat(PASSKEY_LABEL_MAX + 1), password: "pw", code: "" },
      t,
    );
    expect(failure?.fields).toEqual(["label"]);
    expect(failure?.message).toBe(t(PASSKEY_KEYS.labelTooLong));
  });

  it("accepts a label of exactly 64 characters", () => {
    expect(
      validatePasskeyForm({ label: "x".repeat(PASSKEY_LABEL_MAX), password: "pw", code: "" }, t),
    ).toBeNull();
  });

  it("requires the current password (not trimmed)", () => {
    const failure = validatePasskeyForm({ label: "MacBook", password: "", code: "123456" }, t);
    expect(failure).toEqual({ message: t(PASSKEY_KEYS.passwordRequired), fields: ["password"] });
  });

  it("checks the label before the password (闭表顺序)", () => {
    const failure = validatePasskeyForm(EMPTY_PASSKEY_FORM, t);
    expect(failure?.fields).toEqual(["label"]);
  });
});

describe("describePasskeyFailure", () => {
  it("maps 400 to bad_request", () => {
    expect(describePasskeyFailure(400, { error: "bad_request" }, t).message).toBe(
      t(PASSKEY_KEYS.badRequest),
    );
  });

  it("maps 401 unauthorized to the session-expired copy", () => {
    expect(describePasskeyFailure(401, { error: "unauthorized" }, t).message).toBe(
      t(PASSKEY_KEYS.unauthorized),
    );
  });

  it("maps any other 401 to the wrong-password copy and flags the password field", () => {
    const failure = describePasskeyFailure(401, {}, t);
    expect(failure.message).toBe(t(PASSKEY_KEYS.invalidCredentials));
    expect(failure.fields).toEqual(["password"]);
  });

  it("maps 403 / 404 / 503 to their own copy", () => {
    expect(describePasskeyFailure(403, { error: "forbidden" }, t).message).toBe(
      t(PASSKEY_KEYS.forbidden),
    );
    expect(describePasskeyFailure(404, { error: "not_found" }, t).message).toBe(
      t(PASSKEY_KEYS.notFound),
    );
    expect(describePasskeyFailure(503, {}, t).message).toBe(t(PASSKEY_KEYS.unavailable));
  });

  it("interpolates retryAfter on 429 and falls back to the plain copy", () => {
    expect(describePasskeyFailure(429, { error: "locked", retryAfter: 30 }, t).message).toBe(
      t(PASSKEY_KEYS.locked, { seconds: 30 }),
    );
    expect(describePasskeyFailure(429, { error: "locked" }, t).message).toBe(
      t(PASSKEY_KEYS.lockedPlain),
    );
  });

  it("falls back to generic for unknown statuses and non-object bodies", () => {
    expect(describePasskeyFailure(418, null, t).message).toBe(t(PASSKEY_KEYS.generic));
    expect(describePasskeyFailure(500, "text/plain", t).message).toBe(t(PASSKEY_KEYS.generic));
  });
});

describe("isInvalidTotp", () => {
  it("is true only for 401 invalid_totp", () => {
    expect(isInvalidTotp(401, { error: "invalid_totp" })).toBe(true);
    expect(isInvalidTotp(401, { error: "unauthorized" })).toBe(false);
    expect(isInvalidTotp(400, { error: "invalid_totp" })).toBe(false);
    expect(isInvalidTotp(401, null)).toBe(false);
  });
});
