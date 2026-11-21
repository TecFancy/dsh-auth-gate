import { createHash, randomBytes } from "node:crypto";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { buildCookie } from "../../../shared/http/index.js";
import { z } from "zod";
import { BOOTSTRAP_SESSION_KIND } from "../../../shared/protocol/index.js";
/** 会话 cookie 属性（M2 起使用；M1 冻结并测试）。 */
export const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";
/**
 * 精确输出 `<name>=<token>; Max-Age=<secs>; Path=/; HttpOnly; Secure; SameSite=Lax`；
 * `secure=false` 时省略 `; Secure`（http 测试/开发，M7）。
 *
 * 属性模板只有一份，在 `shared/http` 的 `buildCookie`：重铸标记与它会话 cookie 共用同一组
 * 属性，避免两处各写一遍后漂移。本函数保留名字与签名，因为 M1/M2 的冻结测试钉的是它。
 */
export function buildSetCookie(cookieName, token, maxAgeSeconds, secure = true) {
    return buildCookie(cookieName, token, maxAgeSeconds, secure);
}
/** 会话 token 的落盘键：sha256 hex 小写（64 字符）；介质上永不出现原始 token。 */
export function digestToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
/**
 * 是否 bootstrap 会话（只读 `kind`；缺省 / 其它类别一律 false）。
 * 门用它把「只放行 `/auth/*`」的临时会话与正式会话分开，不做任何 IO。
 */
export function isBootstrapSession(session) {
    return session?.kind === BOOTSTRAP_SESSION_KIND;
}
const sessionRowSchema = z.object({
    subject: z.string(),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    revoked: z.boolean(),
    // 可选：P2 之前写入的行没有该字段，必须继续可解析（缺省按 full 处理）。
    // 注意：本仓库的 zod 是 v4（`z.enum`/`z.literal`），没有 `z.const`
    // （后者是 @deepseek-ai/schemastery 的 API，见 src/index.ts 的 Config）。
    kind: z.enum(["full", "password-change-only", "bootstrap"]).optional(),
});
/** 键 = digest（sha256 hex），不进 row；row 只存以上四字段。 */
export const sessionDomainSpec = defineDomain({
    // 必须匹配 UNIT_NAME_RE（无连字符，见 docs/history/specs/impl-m1.md §2.2）
    name: "dsh_auth_sessions",
    version: 0,
    tables: { sessions: domainTable(sessionRowSchema) },
});
/** 缺省过期行清扫间隔（毫秒）：`create` 至多每 60s 触发一次全表扫描。 */
export const DEFAULT_PRUNE_INTERVAL_MS = 60_000;
/** 对一张 KvTable 编程的会话存储；domain 的 open/close 由 index.ts 接线。 */
export class SessionStore {
    table;
    pruneIntervalMs;
    now;
    /** 上次清扫时刻；`-Infinity` = 还没扫过（首次 create 必扫）。 */
    lastPruneAt = Number.NEGATIVE_INFINITY;
    constructor(table, options = {}) {
        this.table = table;
        this.pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
        this.now = options.now ?? Date.now;
    }
    async create(subject, ttlMs, kind = "full") {
        const now = this.now();
        await this.pruneIfDue(now);
        const token = randomBytes(32).toString("base64url");
        const session = {
            subject,
            createdAt: now,
            expiresAt: now + ttlMs,
            revoked: false,
            kind,
        };
        await this.table.put(digestToken(token), session);
        return { token, session };
    }
    /** 同步内存读 + 校验；有效则返回行（不修改），否则 undefined。 */
    getByToken(token) {
        const row = this.table.get(digestToken(token));
        if (row === undefined || row.revoked || row.expiresAt <= this.now()) {
            return undefined;
        }
        return row;
    }
    /** 吊销 = 删除行（登出语义，写盘）；不存在返回 false。 */
    revokeByToken(token) {
        return this.table.delete(digestToken(token));
    }
    /**
     * 吊销某个 subject（用户名）的**全部**会话行，返回吊销条数（写盘）。
     * 用途：`dsh-auth user disable` 之后，已发 cookie / Bearer token 立即失效；
     * 行内没有主体索引，故按 row.subject 全表扫描（会话量级为单机用户数，成本可忽略）。
     */
    async revokeBySubject(subject) {
        return this.deleteWhere((row) => row.subject === subject);
    }
    /**
     * 吊销某个 subject 中 `createdAt` 早于 `createdAtBefore`（epoch ms）的会话行。
     * 用途：口令变更（users.yaml 的 `password_changed_at`）后作废变更前签发的会话；
     * 变更后签发的会话保留，因此重复扫描是幂等的（CLI 改密走这条路径）。
     */
    async revokeBySubjectBefore(subject, createdAtBefore) {
        return this.deleteWhere((row) => row.subject === subject && row.createdAt < createdAtBefore);
    }
    /**
     * 吊销某个类别的**全部**会话行，返回吊销条数（写盘）。
     * 用途：首次配置向导成功后关掉引导窗口（`bootstrap` 会话一律失效）。
     * 行内没有类别索引，故按 row.kind 全表扫描（与 `revokeBySubject` 同款理由）。
     */
    async revokeByKind(kind) {
        return this.deleteWhere((row) => row.kind === kind);
    }
    /**
     * 出现过**非引导**会话的 subject 去重集合（无序）。供扫描器找出已从 users.yaml
     * 删除的用户的残留会话；bootstrap 引导会话不属于任何用户，故按 kind 排除。
     */
    subjects() {
        const seen = new Set();
        for (const [, row] of this.table.entries()) {
            if (row.kind === BOOTSTRAP_SESSION_KIND)
                continue;
            seen.add(row.subject);
        }
        return [...seen];
    }
    /** 全表扫描删除过期行，返回删除数。 */
    async pruneExpired(now = this.now()) {
        return this.deleteWhere((row) => row.expiresAt <= now);
    }
    /** 距上次清扫不足 `pruneIntervalMs` → 0；否则记下本次时刻并清扫（并发 create 只有一个真扫）。 */
    async pruneIfDue(now) {
        if (now - this.lastPruneAt < this.pruneIntervalMs)
            return 0;
        this.lastPruneAt = now;
        return this.pruneExpired(now);
    }
    /** 先收集键再单批删除：不在迭代中删除，且整批只占一个写槽。 */
    async deleteWhere(predicate) {
        const keys = [];
        for (const [key, row] of this.table.entries()) {
            if (predicate(row))
                keys.push(key);
        }
        if (keys.length === 0)
            return 0;
        return this.table.deleteMany(keys);
    }
}
