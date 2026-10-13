export declare const SCRYPT_N = 65536;
export declare const SCRYPT_R = 8;
export declare const SCRYPT_P = 1;
export declare const SCRYPT_KEYLEN = 32;
export declare const SCRYPT_MAXMEM: number;
/**
 * 未知用户登录时的占位哈希（P3）：salt=16×0x7a 的固定常量，验证成本与真用户一致。
 * 对应口令字面量只出现在测试断言中，不是秘密。
 */
export declare const DUMMY_HASH = "scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k";
/** 生成 `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`（salt 16 字节随机）。 */
export declare function hashPassword(password: string): Promise<string>;
/**
 * 恒时验证：解析 stored 参数后按存储值重派生（P2：未来调参旧哈希仍可验证）；
 * 格式/参数非法 → false，不抛（派生异常同样归为 false）。
 */
export declare function verifyPassword(password: string, stored: string): Promise<boolean>;
//# sourceMappingURL=password.d.ts.map