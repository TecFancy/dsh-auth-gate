import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 4648 base32 字母表（无填充、大写惯例）。 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** TOTP 时间步长（秒，RFC 6238 默认 30）。 */
const TOTP_STEP_SECONDS = 30;

/** 验证码位数（RFC 6238 默认 6）。 */
const TOTP_DIGITS = 6;

/** 校验位对应的 10 进制取模值（10^6）。 */
const TOTP_MODULO = 1_000_000;

/**
 * base32 编码（RFC 4648，无填充，大写）。20 随机字节 → 32 字符。
 * 位操作在 JS number 内进行（工作区 ≤ 12 比特，安全）。
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** base32 解码（RFC 4648，容忍尾部 `=` 与大小写）；非法字符 → throw。 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const index = BASE32_ALPHABET.indexOf(ch);
    if (index === -1) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** 生成新 TOTP secret：20 随机字节 → base32（160 比特，Authenticator 兼容）。 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP（RFC 4226）：HMAC-SHA1 + 动态截断 → 6 位零填充字符串。 */
function hotpCode(secret: Uint8Array, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const last = digest[digest.length - 1];
  if (last === undefined) return "000000"; // 不可达（SHA-1 恒 20 字节），仅类型收窄
  const offset = last & 0x0f;
  // 动态截断（RFC 4226 §5.3）：取 offset 起 4 字节大端整数，清符号位
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % TOTP_MODULO).padStart(TOTP_DIGITS, "0");
}

/** 计算指定计数器的 6 位 code（集成测试/对拍用；生产验证走 verifyTotpCode）。 */
export function totpCodeAt(secretB32: string, counter: number): string {
  let secret: Uint8Array;
  try {
    secret = base32Decode(secretB32);
  } catch {
    return "000000"; // 非法 secret：调用方（测试/对拍）预期输入合法；不抛
  }
  return hotpCode(secret, counter);
}

/**
 * TOTP 窗口验证（RFC 6238）：对 `floor(nowMs/30000) ± window` 的计数器逐个恒时比较。
 * 命中 → 返回匹配的计数器（供防重放记录）；未命中/secret 非法/位数不符 → undefined。
 * 恒时：仅 timingSafeEqual（等长 ASCII buffer），无 `===` 快路径。
 */
export function verifyTotpCode(
  secretB32: string,
  code: string,
  nowMs: number,
  window = 1,
): number | undefined {
  if (code.length !== TOTP_DIGITS) return undefined;
  let secret: Uint8Array;
  try {
    secret = base32Decode(secretB32);
  } catch {
    return undefined; // 非法 secret：验证失败，不抛（users 文件可含任意字符串，P4）
  }
  const t0 = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  const expected = Buffer.from(code, "ascii");
  for (let w = -window; w <= window; w++) {
    const candidate = Buffer.from(hotpCode(secret, t0 + w), "ascii");
    if (timingSafeEqual(candidate, expected)) return t0 + w;
  }
  return undefined;
}
