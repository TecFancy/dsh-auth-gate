import { createHash, timingSafeEqual } from "node:crypto";
/**
 * 恒时比较（M17）：双方 sha256 Buffer 摘要后 `timingSafeEqual`。
 * `timingSafeEqual` 只接受 Buffer/TypedArray；hex 字符串直接 TypeError。Buffer 摘要双方
 * 恒 32 字节，所以比较本身不泄漏长度侧信道。
 *
 * 只回答「两个字符串是否相等」，不区分失败原因；调用方一律把假当作拒绝。
 */
export function safeEqual(input, stored) {
    const inputDigest = createHash("sha256").update(input).digest();
    const storedDigest = createHash("sha256").update(stored).digest();
    return timingSafeEqual(inputDigest, storedDigest);
}
//# sourceMappingURL=safe-equal.js.map