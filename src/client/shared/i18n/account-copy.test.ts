import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../api/index.ts";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, ACCOUNT_KEYS } from "./index.ts";

/**
 * C12：口令策略文案里的长度边界必须来自跨半边契约（`PASSWORD_MIN_LENGTH` /
 * `PASSWORD_MAX_LENGTH`），而不是文案自己写一份 14/256。改契约会让这里的断言与文案一起变。
 */
describe("password policy copy mirrors the contract limits", () => {
  it("renders the contract min/max in both languages", () => {
    for (const dict of [ACCOUNT_DICT_ZH, ACCOUNT_DICT_EN]) {
      expect(dict[ACCOUNT_KEYS.policyHint]).toContain(String(PASSWORD_MIN_LENGTH));
      expect(dict[ACCOUNT_KEYS.ruleMinLength]).toContain(String(PASSWORD_MIN_LENGTH));
      expect(dict[ACCOUNT_KEYS.ruleMaxLength]).toContain(String(PASSWORD_MAX_LENGTH));
    }
  });
});
