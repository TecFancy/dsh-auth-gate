import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { base32Decode, base32Encode, generateTotpSecret, verifyTotpCode } from "./totp.js";

/** RFC 6238 附录 B 的测试密钥（ASCII "12345678901234567890" 的 base32 形式）。 */
const RFC_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("round-trips 20 random bytes", () => {
    for (let i = 0; i < 50; i++) {
      const bytes = randomBytes(20);
      const encoded = base32Encode(bytes);
      expect(encoded).toMatch(/^[A-Z2-7]{32}$/); // 20 字节 -> 32 字符，无填充
      expect(Buffer.from(base32Decode(encoded)).equals(bytes)).toBe(true);
    }
  });

  it("decodes lowercase and tolerates padding", () => {
    const bytes = base32Decode(`${RFC_SECRET_B32.toLowerCase()}======`);
    expect(Buffer.from(bytes).equals(Buffer.from("12345678901234567890", "ascii"))).toBe(true);
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("ABC0")).toThrow(); // 0 不在 base32 字母表
    expect(() => base32Decode("abc!")).toThrow();
  });
});

describe("verifyTotpCode RFC 6238 Appendix B vectors (SHA-1)", () => {
  // 官方向量：T 是 Unix 秒（counter = floor(T/30)）；8 位 code 取后 6 位。
  // 期望返回匹配的 counter。
  const vectors: [number, string, number][] = [
    [59, "94287082", 1],
    [1111111109, "07081804", 37037036],
    [1111111111, "14050471", 37037037],
    [1234567890, "89005924", 41152263],
    [2000000000, "69279037", 66666666],
    [20000000000, "65353130", 666666666],
  ];

  for (const [t, expected8, counter] of vectors) {
    it(`matches T=${t}`, () => {
      const matched = verifyTotpCode(RFC_SECRET_B32, expected8.slice(-6), t * 1000);
      expect(matched).toBe(counter);
    });
  }

  it("matches the RFC 4226 Appendix D vector (counter 0 -> 755224)", () => {
    // T=0 秒 → counter 0；RFC 4226 附录 D HOTP(0)=755224
    expect(verifyTotpCode(RFC_SECRET_B32, "755224", 0)).toBe(0);
  });
});

describe("verifyTotpCode window (±1)", () => {
  // 已知 T=59s（counter 1）的 6 位 code "287082"，验证窗口边界
  const code = "287082";
  const counter = 1;

  it("accepts at counter-1, counter, counter+1 (nowMs aligned)", () => {
    expect(verifyTotpCode(RFC_SECRET_B32, code, counter * 30_000)).toBe(counter);
    // nowMs 取 counter 的相邻 30s 窗口
    expect(verifyTotpCode(RFC_SECRET_B32, code, (counter - 1) * 30_000)).toBe(counter);
    expect(verifyTotpCode(RFC_SECRET_B32, code, (counter + 1) * 30_000)).toBe(counter);
  });

  it("rejects outside the window (counter-2 / counter+2)", () => {
    expect(verifyTotpCode(RFC_SECRET_B32, code, (counter - 2) * 30_000)).toBeUndefined();
    expect(verifyTotpCode(RFC_SECRET_B32, code, (counter + 2) * 30_000)).toBeUndefined();
  });

  it("rejects wrong code / wrong length / invalid secret", () => {
    expect(verifyTotpCode(RFC_SECRET_B32, "000000", counter * 30_000)).toBeUndefined();
    expect(verifyTotpCode(RFC_SECRET_B32, "12345", counter * 30_000)).toBeUndefined();
    expect(verifyTotpCode(RFC_SECRET_B32, "1234567", counter * 30_000)).toBeUndefined();
    expect(verifyTotpCode("not-base32!!", code, counter * 30_000)).toBeUndefined();
    expect(verifyTotpCode("", code, counter * 30_000)).toBeUndefined();
  });
});

describe("generateTotpSecret", () => {
  it("produces 32-char uppercase base32, unique per call", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(b).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
  });

  it("decodes to 20 bytes", () => {
    expect(base32Decode(generateTotpSecret()).length).toBe(20);
  });
});
