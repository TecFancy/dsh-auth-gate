/**
 * base32 编码（RFC 4648，无填充，大写）。20 随机字节 → 32 字符。
 * 位操作在 JS number 内进行（工作区 ≤ 12 比特，安全）。
 */
export declare function base32Encode(bytes: Uint8Array): string;
/** base32 解码（RFC 4648，容忍尾部 `=` 与大小写）；非法字符 → throw。 */
export declare function base32Decode(text: string): Uint8Array;
/** 生成新 TOTP secret：20 随机字节 → base32（160 比特，Authenticator 兼容）。 */
export declare function generateTotpSecret(): string;
/** 计算指定计数器的 6 位 code（集成测试/对拍用；生产验证走 verifyTotpCode）。 */
export declare function totpCodeAt(secretB32: string, counter: number): string;
/**
 * TOTP 窗口验证（RFC 6238）：对 `floor(nowMs/30000) ± window` 的计数器逐个恒时比较。
 * 命中 → 返回匹配的计数器（供防重放记录）；未命中/secret 非法/位数不符 → undefined。
 * 恒时：仅 timingSafeEqual（等长 ASCII buffer），无 `===` 快路径。
 */
export declare function verifyTotpCode(secretB32: string, code: string, nowMs: number, window?: number): number | undefined;
//# sourceMappingURL=totp.d.ts.map