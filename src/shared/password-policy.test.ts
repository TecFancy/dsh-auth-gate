import { describe, expect, it, vi } from "vitest";
import {
  checkPasswordPolicy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordRule,
} from "./password-policy.js";

/** 满足全部字符类的最短口令（14 字符，含大写/小写/数字/special）。 */
const VALID = "Abcdefgh1234!x";

function pad(base: string, length: number): string {
  return base + "a".repeat(Math.max(0, length - base.length));
}

describe("checkPasswordPolicy: length boundaries", () => {
  it("rejects 13 characters with minLength", async () => {
    const result = await checkPasswordPolicy(VALID.slice(0, 13));
    expect(result.ok).toBe(false);
    expect(result.rules).toEqual(["minLength"]);
  });

  it("accepts exactly 14 characters", async () => {
    expect(VALID).toHaveLength(PASSWORD_MIN_LENGTH);
    await expect(checkPasswordPolicy(VALID)).resolves.toEqual({ ok: true, rules: [] });
  });

  it("accepts exactly 256 characters", async () => {
    const password = pad(VALID, PASSWORD_MAX_LENGTH);
    expect(password).toHaveLength(256);
    await expect(checkPasswordPolicy(password)).resolves.toEqual({ ok: true, rules: [] });
  });

  it("rejects 257 characters with maxLength only", async () => {
    const password = pad(VALID, PASSWORD_MAX_LENGTH + 1);
    const result = await checkPasswordPolicy(password);
    expect(result.ok).toBe(false);
    expect(result.rules).toEqual(["maxLength"]);
  });

  it("reports minLength first, in declaration order, for an empty password", async () => {
    const result = await checkPasswordPolicy("");
    expect(result.rules).toEqual<PasswordRule[]>([
      "minLength",
      "uppercase",
      "lowercase",
      "digit",
      "special",
    ]);
  });

  it("does not truncate: 300 characters still fails maxLength", async () => {
    const result = await checkPasswordPolicy(pad(VALID, 300));
    expect(result.rules).toEqual(["maxLength"]);
  });

  it("does not trim: a 13-character body plus one trailing space passes minLength", async () => {
    const password = `${VALID.slice(0, 13)} `;
    expect(password).toHaveLength(14);
    await expect(checkPasswordPolicy(password)).resolves.toEqual({ ok: true, rules: [] });
  });
});

describe("checkPasswordPolicy: character classes", () => {
  const cases: { password: string; rule: PasswordRule }[] = [
    { password: "abcdefgh1234!x", rule: "uppercase" },
    { password: "ABCDEFGH1234!X", rule: "lowercase" },
    { password: "Abcdefghijkl!X", rule: "digit" },
    { password: "Abcdefgh1234Xy", rule: "special" },
  ];
  for (const { password, rule } of cases) {
    it(`reports ${rule} when that class is missing`, async () => {
      expect(password).toHaveLength(PASSWORD_MIN_LENGTH);
      const result = await checkPasswordPolicy(password);
      expect(result.ok).toBe(false);
      expect(result.rules).toEqual([rule]);
    });
  }

  it("counts a space as a special character", async () => {
    await expect(checkPasswordPolicy("Abcdefgh1234 X")).resolves.toEqual({ ok: true, rules: [] });
  });

  it("lists every missing class in enum order", async () => {
    const result = await checkPasswordPolicy("aaaaaaaaaaaaaaaa");
    expect(result.rules).toEqual<PasswordRule[]>(["uppercase", "digit", "special"]);
  });
});

describe("checkPasswordPolicy: sameAsOld", () => {
  it("rejects a new password that verifies against the old hash", async () => {
    const verifyOld = vi.fn(() => Promise.resolve(true));
    const result = await checkPasswordPolicy(VALID, { oldPasswordHash: "h", verifyOld });
    expect(result.ok).toBe(false);
    expect(result.rules).toEqual(["sameAsOld"]);
    expect(verifyOld).toHaveBeenCalledWith(VALID, "h");
  });

  it("accepts when the old-password comparison misses", async () => {
    const verifyOld = vi.fn(() => Promise.resolve(false));
    await expect(checkPasswordPolicy(VALID, { oldPasswordHash: "h", verifyOld })).resolves.toEqual({
      ok: true,
      rules: [],
    });
    expect(verifyOld).toHaveBeenCalledTimes(1);
  });

  it("skips the comparison when the hash or the comparator is missing", async () => {
    const verifyOld = vi.fn(() => Promise.resolve(true));
    await expect(checkPasswordPolicy(VALID)).resolves.toEqual({ ok: true, rules: [] });
    await expect(checkPasswordPolicy(VALID, { verifyOld })).resolves.toEqual({
      ok: true,
      rules: [],
    });
    await expect(checkPasswordPolicy(VALID, { oldPasswordHash: "h" })).resolves.toEqual({
      ok: true,
      rules: [],
    });
    expect(verifyOld).not.toHaveBeenCalled();
  });

  it("does not run the old-password comparison when the length fails", async () => {
    const verifyOld = vi.fn(() => Promise.resolve(true));
    const result = await checkPasswordPolicy(VALID.slice(0, 13), {
      oldPasswordHash: "h",
      verifyOld,
    });
    expect(result.rules).toEqual(["minLength"]);
    expect(verifyOld).not.toHaveBeenCalled();
  });

  it("does not run the old-password comparison when a character class fails", async () => {
    const verifyOld = vi.fn(() => Promise.resolve(true));
    const result = await checkPasswordPolicy("abcdefgh1234!x", {
      oldPasswordHash: "h",
      verifyOld,
    });
    expect(result.rules).toEqual(["uppercase"]);
    expect(verifyOld).not.toHaveBeenCalled();
  });
});
