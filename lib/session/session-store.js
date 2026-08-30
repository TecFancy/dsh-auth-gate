import { createHash, randomBytes } from "node:crypto";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
/** 会话 cookie 属性（M2 起使用；M1 冻结并测试）。 */
export const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";
/**
 * 精确输出 `<name>=<token>; Max-Age=<secs>; Path=/; HttpOnly; Secure; SameSite=Lax`；
 * `secure=false` 时省略 `; Secure`（http 测试/开发，M7）。
 */
export function buildSetCookie(cookieName, token, maxAgeSeconds, secure = true) {
    return `${cookieName}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`;
}
/** 会话 token 的落盘键：sha256 hex 小写（64 字符）；介质上永不出现原始 token。 */
export function digestToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
const sessionRowSchema = z.object({
    subject: z.string(),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    revoked: z.boolean(),
});
/** 键 = digest（sha256 hex），不进 row；row 只存以上四字段。 */
export const sessionDomainSpec = defineDomain({
    // 必须匹配 UNIT_NAME_RE（无连字符，见 docs/implemented/impl-m1.md §2.2）
    name: "dsh_auth_sessions",
    version: 0,
    tables: { sessions: domainTable(sessionRowSchema) },
});
/** 对一张 KvTable 编程的会话存储；domain 的 open/close 由 index.ts 接线。 */
export class SessionStore {
    table;
    constructor(table) {
        this.table = table;
    }
    async create(subject, ttlMs) {
        await this.pruneExpired();
        const token = randomBytes(32).toString("base64url");
        const now = Date.now();
        const session = {
            subject,
            createdAt: now,
            expiresAt: now + ttlMs,
            revoked: false,
        };
        await this.table.put(digestToken(token), session);
        return { token, session };
    }
    /** 同步内存读 + 校验；有效则返回行（不修改），否则 undefined。 */
    getByToken(token) {
        const row = this.table.get(digestToken(token));
        if (row === undefined || row.revoked || row.expiresAt <= Date.now()) {
            return undefined;
        }
        return row;
    }
    // TODO(auth-m5): revokeBySubject - disabled users only block new logins (T13/D8).
    /** 吊销 = 删除行（登出语义，写盘）；不存在返回 false。 */
    revokeByToken(token) {
        return this.table.delete(digestToken(token));
    }
    /** 全表扫描删除过期行，返回删除数。 */
    async pruneExpired(now = Date.now()) {
        let count = 0;
        for (const [key, row] of this.table.entries()) {
            if (row.expiresAt <= now) {
                await this.table.delete(key);
                count += 1;
            }
        }
        return count;
    }
}
//# sourceMappingURL=session-store.js.map