import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

type ScryptFn = (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const scrypt = promisify(scryptCb) as ScryptFn;

export const SCRYPT_N = 65536;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 32;
export const SCRYPT_MAXMEM = 128 * 1024 * 1024;

/**
 * 未知用户登录时的占位哈希（P3）：salt=16×0x7a 的固定常量，验证成本与真用户一致。
 * 对应口令字面量只出现在测试断言中，不是秘密。
 */
export const DUMMY_HASH =
  "scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k";

/** 生成 `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`（salt 16 字节随机）。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
}

/** 校验并解析 scrypt 参数段（防恶意放大内存的 N/r/p 上限）。 */
function parseParams(parts: string[]): { n: number; r: number; p: number } | undefined {
  if (parts.length !== 6 || parts[0] !== "scrypt") return undefined;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return undefined;
  if (n <= 0 || n > 2 ** 17 || r <= 0 || r > 32 || p <= 0 || p > 4) return undefined;
  return { n, r, p };
}

/** 解析存储串；格式/参数非法 → undefined。 */
function parseStored(stored: string): ParsedHash | undefined {
  const params = parseParams(stored.split("$"));
  if (params === undefined) return undefined;
  const salt = Buffer.from(stored.split("$")[4] ?? "", "base64url");
  const expected = Buffer.from(stored.split("$")[5] ?? "", "base64url");
  if (salt.length !== 16 || expected.length !== SCRYPT_KEYLEN) return undefined;
  return { ...params, salt, expected };
}

/**
 * 恒时验证：解析 stored 参数后按存储值重派生（P2：未来调参旧哈希仍可验证）；
 * 格式/参数非法 → false，不抛（派生异常同样归为 false）。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (parsed === undefined) return false;
  try {
    const key = await scrypt(password, parsed.salt, SCRYPT_KEYLEN, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_MAXMEM,
    });
    return timingSafeEqual(key, parsed.expected);
  } catch {
    return false;
  }
}
