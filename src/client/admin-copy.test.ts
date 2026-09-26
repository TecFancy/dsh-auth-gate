import { describe, expect, it } from "vitest";
import { ADMIN_DICT_EN, ADMIN_DICT_ZH, ADMIN_KEYS, translateAdminFrom } from "./admin-copy.ts";

/** 冻结键集 = 契约 §4 全表 40 键 + §9/A4 新增 2 键。 */
const KEYS: string[] = Object.values(ADMIN_KEYS);

const byName = (a: string, b: string): number => a.localeCompare(b);

describe("admin dictionary (contract §4 + §9/A4)", () => {
  it("ships the same key set in zh and en, matching ADMIN_KEYS exactly", () => {
    const zh = Object.keys(ADMIN_DICT_ZH).sort(byName);
    const en = Object.keys(ADMIN_DICT_EN).sort(byName);
    expect(zh).toEqual(en);
    expect(zh).toEqual([...KEYS].sort(byName));
    expect(KEYS).toHaveLength(42);
  });

  it("has a non-empty and distinct translation for every key", () => {
    for (const key of KEYS) {
      expect(ADMIN_DICT_ZH[key]?.length).toBeGreaterThan(0);
      expect(ADMIN_DICT_EN[key]?.length).toBeGreaterThan(0);
      expect(ADMIN_DICT_EN[key]).not.toBe(ADMIN_DICT_ZH[key]);
    }
  });

  it("pins the copy that the state machine depends on", () => {
    expect(ADMIN_DICT_ZH[ADMIN_KEYS.successRevoked]).toBe("已重置，该用户的会话已全部吊销。");
    expect(ADMIN_DICT_EN[ADMIN_KEYS.successRevoked]).toBe(
      "Reset done. All of that user's sessions were revoked.",
    );
    expect(ADMIN_DICT_ZH[ADMIN_KEYS.successKept]).toBe(
      "已重置，但该用户的现有会话仍然有效（吊销失败），请手动处理。",
    );
    expect(ADMIN_DICT_EN[ADMIN_KEYS.successKept]).not.toBe(
      ADMIN_DICT_EN[ADMIN_KEYS.successRevoked],
    );
    expect(ADMIN_DICT_ZH[ADMIN_KEYS.intro]).toBe(
      "重置后，该用户下次登录会被要求立即改密；会话吊销若失败会单独提示。",
    );
    expect(ADMIN_DICT_ZH[ADMIN_KEYS.selfHint]).toContain("dsh-auth user passwd");
    expect(ADMIN_DICT_EN[ADMIN_KEYS.stateOk]).toBe("Normal");
    expect(ADMIN_DICT_EN[ADMIN_KEYS.forbidden]).toBe(
      "You are not allowed to do this, or this session is not allowed to.",
    );
    expect(ADMIN_DICT_EN[ADMIN_KEYS.codeHint]).toContain("another user");
    expect(ADMIN_DICT_EN[ADMIN_KEYS.locked]).toBe(
      "Too many attempts. Try again in {seconds} seconds.",
    );
  });

  it("ships the two A4 additions with the frozen copy", () => {
    expect(ADMIN_KEYS.codeRequired).toBe("admin.codeRequired");
    expect(ADMIN_DICT_ZH[ADMIN_KEYS.codeRequired]).toBe("请输入动态验证码。");
    expect(ADMIN_DICT_EN[ADMIN_KEYS.codeRequired]).toBe("Enter the verification code.");
    expect(ADMIN_KEYS.targetPlaceholder).toBe("admin.targetPlaceholder");
    expect(ADMIN_DICT_ZH[ADMIN_KEYS.targetPlaceholder]).toBe("请选择用户");
    expect(ADMIN_DICT_EN[ADMIN_KEYS.targetPlaceholder]).toBe("Choose a user");
  });
});

describe("translateAdminFrom", () => {
  it("interpolates params exactly like the host locale does", () => {
    expect(translateAdminFrom(ADMIN_DICT_ZH)(ADMIN_KEYS.locked, { seconds: 42 })).toBe(
      "尝试次数过多，请在 42 秒后重试。",
    );
    expect(translateAdminFrom(ADMIN_DICT_EN)(ADMIN_KEYS.locked, { seconds: 7 })).toBe(
      "Too many attempts. Try again in 7 seconds.",
    );
  });

  it("falls back to the English dictionary for a key missing from the given one", () => {
    const partial = translateAdminFrom({ [ADMIN_KEYS.title]: "Titel" });
    expect(partial(ADMIN_KEYS.title)).toBe("Titel");
    expect(partial(ADMIN_KEYS.submit)).toBe("Reset password");
  });

  it("never renders a raw key when both dictionaries miss it", () => {
    expect(translateAdminFrom({})("admin.not.in.the.table")).toBe("");
  });
});
