import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.js";

const HASH_RE = /^scrypt\$65536\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
const DUMMY_PASSWORD = "dsh-auth-dummy-password-for-timing-uniformity";

describe("hashPassword", () => {
  it("produces the frozen parameter format", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(HASH_RE);
  });

  it("uses a fresh random salt per call", async () => {
    const first = await hashPassword("pw");
    const second = await hashPassword("pw");
    expect(first).not.toBe(second);
  });

  it("round-trips with verifyPassword", async () => {
    const hash = await hashPassword("s3cret");
    await expect(verifyPassword("s3cret", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("right");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("accepts an empty password", async () => {
    const hash = await hashPassword("");
    await expect(verifyPassword("", hash)).resolves.toBe(true);
  });
});

describe("verifyPassword malformed input", () => {
  it("rejects wrong segment counts and prefix", async () => {
    await expect(verifyPassword("pw", "scrypt$1$2")).resolves.toBe(false);
    await expect(verifyPassword("pw", "bcrypt$1$2$3$a$b")).resolves.toBe(false);
  });

  it("rejects non-numeric or out-of-range params", async () => {
    await expect(
      verifyPassword(
        "pw",
        "scrypt$x$8$1$enp6enp6enp6enp6enp6eg$enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6eg",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "pw",
        "scrypt$131072$8$1$enp6enp6enp6enp6enp6eg$enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6eg",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "pw",
        "scrypt$65536$64$1$enp6enp6enp6enp6enp6eg$enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6eg",
      ),
    ).resolves.toBe(false);
  });

  it("rejects bad salt/hash lengths and invalid base64url", async () => {
    await expect(
      verifyPassword("pw", "scrypt$65536$8$1$enp6eg$enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6eg"),
    ).resolves.toBe(false);
    await expect(verifyPassword("pw", "scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$!!")).resolves.toBe(
      false,
    );
  });
});

describe("DUMMY_HASH", () => {
  it("verifies the frozen dummy password", async () => {
    await expect(verifyPassword(DUMMY_PASSWORD, DUMMY_HASH)).resolves.toBe(true);
  });

  it("rejects any other password", async () => {
    await expect(verifyPassword("anything-else", DUMMY_HASH)).resolves.toBe(false);
  });
});

describe("verifyPassword parameter evolution", () => {
  it("derives with the params stored in the hash, not the current constants", async () => {
    const salt = Buffer.alloc(16, 1);
    const key = scryptSync("pw", salt, 32, { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const legacy = `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
    // 验证走 stored 里的 N=16384，而不是模块常量 65536；旧参数哈希在新常量下仍可验证
    await expect(verifyPassword("pw", legacy)).resolves.toBe(true);
    await expect(verifyPassword("other", legacy)).resolves.toBe(false);
  });
});
