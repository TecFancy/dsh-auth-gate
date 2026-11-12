/**
 * passkey 词典分片（M6 PR3）：键集合与 zh/en 一致性。
 *
 * 与 admin 分片同一纪律：两套词典的键必须完全一致（缺键会退化成键名或空串），
 * 且每个键都要有非空文案。
 */
import { describe, expect, it } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH } from "./account-copy.ts";
import { PASSKEY_DICT_EN, PASSKEY_DICT_ZH, PASSKEY_KEYS } from "./passkey-copy.ts";

describe("passkey dictionary", () => {
  it("has the same key set in zh and en", () => {
    const byName = (left: string, right: string): number => left.localeCompare(right);
    expect(Object.keys(PASSKEY_DICT_ZH).sort(byName)).toEqual(
      Object.keys(PASSKEY_DICT_EN).sort(byName),
    );
  });

  it("covers every declared key with non-empty copy in both locales", () => {
    for (const key of Object.values(PASSKEY_KEYS)) {
      expect(PASSKEY_DICT_ZH[key]?.length ?? 0).toBeGreaterThan(0);
      expect(PASSKEY_DICT_EN[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("uses the account.passkey namespace and does not collide with account keys", () => {
    for (const key of Object.values(PASSKEY_KEYS)) {
      expect(key.startsWith("account.passkey.")).toBe(true);
      expect(key in ACCOUNT_DICT_ZH).toBe(true);
      expect(key in ACCOUNT_DICT_EN).toBe(true);
    }
  });

  it("is merged into the account dictionaries that the entry registers", () => {
    // `index.tsx` 只注册 ACCOUNT_DICT_*：passkey 键必须已经并进去，否则面板显示键名。
    for (const key of Object.values(PASSKEY_KEYS)) {
      expect(ACCOUNT_DICT_ZH[key]).toBe(PASSKEY_DICT_ZH[key]);
      expect(ACCOUNT_DICT_EN[key]).toBe(PASSKEY_DICT_EN[key]);
    }
  });

  it("keeps the two locales the same size after the merge", () => {
    expect(Object.keys(ACCOUNT_DICT_ZH).length).toBe(Object.keys(ACCOUNT_DICT_EN).length);
  });
});
