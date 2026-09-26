import { describe, expect, it } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH } from "./account-copy.ts";
import { validateAdminReset } from "./admin-api.ts";
import { describeAdminFailure } from "./admin-failure.ts";
import { ADMIN_DICT_EN, ADMIN_DICT_ZH, ADMIN_KEYS, translateAdminFrom } from "./admin-copy.ts";
import type { AdminResetValues } from "./admin-types.ts";

/** 宿主把 account / admin 分片合并成一个 `auth` 命名域（见 index.tsx），测试按同一合并构造 `t`。 */
const zh = translateAdminFrom({ ...ACCOUNT_DICT_ZH, ...ADMIN_DICT_ZH });
const en = translateAdminFrom({ ...ACCOUNT_DICT_EN, ...ADMIN_DICT_EN });

interface FailureCase {
  label: string;
  status: number;
  body: unknown;
  key: string;
  fields: string[];
}

const LISTED: FailureCase[] = [
  {
    label: "400 bad_target",
    status: 400,
    body: { error: "bad_target" },
    key: ADMIN_KEYS.badTarget,
    fields: ["target"],
  },
  {
    label: "401 invalid_totp",
    status: 401,
    body: { error: "invalid_totp" },
    key: ADMIN_KEYS.invalidTotp,
    fields: ["code"],
  },
  {
    label: "401 unauthorized",
    status: 401,
    body: { error: "unauthorized" },
    key: ADMIN_KEYS.unauthorized,
    fields: [],
  },
  {
    label: "403 forbidden",
    status: 403,
    body: { error: "forbidden" },
    key: ADMIN_KEYS.forbidden,
    fields: [],
  },
  {
    label: "404 not_found",
    status: 404,
    body: { error: "not_found" },
    key: ADMIN_KEYS.notFound,
    fields: ["target"],
  },
  {
    label: "429 locked without retryAfter",
    status: 429,
    body: { error: "locked" },
    key: ADMIN_KEYS.lockedPlain,
    fields: [],
  },
  { label: "413 text/plain", status: 413, body: null, key: ADMIN_KEYS.generic, fields: [] },
  { label: "415 text/plain", status: 415, body: null, key: ADMIN_KEYS.generic, fields: [] },
  { label: "503 text/plain", status: 503, body: null, key: ADMIN_KEYS.generic, fields: [] },
];

/** 未列出的组合（含缺 error、错 error、PR1 不存在的 error 码）必须一律 generic（§9/A10）。 */
const UNLISTED: FailureCase[] = [
  { label: "400 without error", status: 400, body: {}, key: ADMIN_KEYS.generic, fields: [] },
  {
    label: "400 unknown error",
    status: 400,
    body: { error: "boom" },
    key: ADMIN_KEYS.generic,
    fields: [],
  },
  { label: "401 without error", status: 401, body: null, key: ADMIN_KEYS.generic, fields: [] },
  {
    label: "401 self is not a code",
    status: 401,
    body: { error: "self" },
    key: ADMIN_KEYS.generic,
    fields: [],
  },
  {
    label: "403 self maps to forbidden only via forbidden",
    status: 403,
    body: { error: "self" },
    key: ADMIN_KEYS.generic,
    fields: [],
  },
  { label: "403 without error", status: 403, body: {}, key: ADMIN_KEYS.generic, fields: [] },
  {
    label: "404 without error",
    status: 404,
    body: { error: "gone" },
    key: ADMIN_KEYS.generic,
    fields: [],
  },
  {
    label: "429 with another error",
    status: 429,
    body: { error: "slow" },
    key: ADMIN_KEYS.generic,
    fields: [],
  },
  { label: "500", status: 500, body: { error: "boom" }, key: ADMIN_KEYS.generic, fields: [] },
  { label: "non-object body", status: 403, body: "forbidden", key: ADMIN_KEYS.generic, fields: [] },
];

describe("describeAdminFailure (contract §1.3 + §9/A10)", () => {
  it.each([...LISTED, ...UNLISTED])("maps $label to its frozen copy", (testCase) => {
    const view = describeAdminFailure(testCase.status, testCase.body, zh);
    expect(view.message).toBe(zh(testCase.key));
    expect(view.fields).toEqual(testCase.fields);
    expect(view.rules).toEqual([]);
  });

  it("interpolates the 429 retryAfter seconds in both languages", () => {
    expect(describeAdminFailure(429, { error: "locked", retryAfter: 17 }, zh).message).toBe(
      "尝试次数过多，请在 17 秒后重试。",
    );
    expect(describeAdminFailure(429, { error: "locked", retryAfter: 17 }, en).message).toBe(
      "Too many attempts. Try again in 17 seconds.",
    );
    expect(describeAdminFailure(429, { error: "locked", retryAfter: "17" }, zh).message).toBe(
      zh(ADMIN_KEYS.lockedPlain),
    );
  });

  it("lists the policy rules through the shared account rule copy", () => {
    const view = describeAdminFailure(
      400,
      { error: "policy", rules: ["minLength", "digit", "mystery", 7] },
      zh,
    );
    expect(view.message).toBe("新密码不符合以下要求：");
    expect(view.rules).toEqual(["至少 14 个字符", "包含数字", "mystery"]);
    expect(view.fields).toEqual(["password"]);
  });

  it("keeps the zh and en surfaces aligned for the stateful keys", () => {
    const kept = describeAdminFailure(403, { error: "forbidden" }, en).message;
    expect(kept).toBe("You are not allowed to do this, or this session is not allowed to.");
    expect(describeAdminFailure(404, { error: "not_found" }, en).message).toBe(
      "The target user does not exist.",
    );
  });
});

const VALID: AdminResetValues = {
  target: "bob",
  password: "NewPassw0rdXZ12",
  confirm: "NewPassw0rdXZ12",
  code: "123456",
};

describe("validateAdminReset (local failure views, §9/A6)", () => {
  it("returns null for a complete form", () => {
    expect(validateAdminReset(VALID, zh)).toBeNull();
    expect(validateAdminReset(VALID, zh, true)).toBeNull();
  });

  it("reports target, password and mismatch in order", () => {
    expect(validateAdminReset({ ...VALID, target: "" }, zh)).toEqual({
      message: "请选择目标用户。",
      rules: [],
      fields: ["target"],
    });
    expect(validateAdminReset({ ...VALID, password: "" }, zh)).toEqual({
      message: "请输入新密码。",
      rules: [],
      fields: ["password"],
    });
    expect(validateAdminReset({ ...VALID, confirm: "" }, zh)).toEqual({
      message: "两次输入的新密码不一致。",
      rules: [],
      fields: ["password", "confirm"],
    });
  });

  it("requires a code only for a TOTP-enabled actor, and trims it", () => {
    expect(validateAdminReset({ ...VALID, code: "" }, zh, true)).toEqual({
      message: "请输入动态验证码。",
      rules: [],
      fields: ["code"],
    });
    expect(validateAdminReset({ ...VALID, code: "   " }, en, true)?.message).toBe(
      "Enter the verification code.",
    );
    // actor 未启用 TOTP：缺码是合法状态（A3 也不发 code 键）
    expect(validateAdminReset({ ...VALID, code: "" }, zh, false)).toBeNull();
  });
});
