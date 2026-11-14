import { randomBytes } from "node:crypto";
/** id 与 challenge 各自的随机字节数（32 字节 base64url 固定 43 字符）。 */
const RANDOM_BYTES = 32;
const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 1024;
/**
 * 进程内一次性 WebAuthn 仪式存储，与 `LoginRateLimiter` / `TotpReplayGuard` 同寿命。
 *
 * 调用方可感知的契约：
 * - **一次性**：`consume` 先删后验，同一 id 并发或重放只有第一次拿到记录，其余 undefined。
 * - **过期即无**：`expiresAt <= now` 的记录视作不存在；清理在 `create`/`consume` 内完成，
 *   不挂定时器，因此没有后台任务需要 dispose。
 * - **容量兜底**：超过 `maxEntries` 时按插入序丢最旧。它不防驱逐攻击，options 端点仍需限速。
 * - **单进程**：Map 只对单实例成立；重启或插件重载后在途仪式全部失效，用户重试一次即可。
 * - 纯内存、无 IO；记录里的字节数组由本存储持有，调用方不得原地修改。
 */
export class CeremonyStore {
    ttlMs;
    maxEntries;
    now;
    random;
    /** Map 迭代序 = 插入序，容量驱逐直接取首个键。 */
    records = new Map();
    constructor(options = {}) {
        this.ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? DEFAULT_TTL_MS));
        this.maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
        this.now = options.now ?? Date.now;
        this.random = options.random ?? randomBytes;
    }
    /**
     * 签发一条仪式记录：先清过期，再按容量丢最旧，最后返回新记录。
     * id 与 challenge 各自独立取 32 字节随机数（注入的随机源会被依次调用两次）。
     */
    create(options) {
        const now = this.now();
        this.prune(now);
        const record = {
            id: encodeBase64Url(this.random(RANDOM_BYTES)),
            challenge: this.random(RANDOM_BYTES),
            kind: options.kind,
            userId: options.userId,
            userHandle: options.userHandle,
            label: options.label,
            expiresAt: now + this.ttlMs,
        };
        while (this.records.size >= this.maxEntries) {
            const oldestId = this.records.keys().next().value;
            if (oldestId === undefined)
                break;
            this.records.delete(oldestId);
        }
        this.records.set(record.id, record);
        return record;
    }
    /**
     * 取出并删除一条记录（先删后验：并发 consume 同一 id 只有一个成功）。
     * 空 id、未知 id、已过期都返回 undefined；返回的记录之后不会再被读出。
     */
    consume(id) {
        if (id === "")
            return undefined;
        const now = this.now();
        const record = this.records.get(id);
        if (record !== undefined)
            this.records.delete(id);
        this.prune(now);
        if (record === undefined || record.expiresAt <= now)
            return undefined;
        return record;
    }
    /** 删除全部过期记录（`expiresAt <= now`）。 */
    prune(now) {
        for (const [id, record] of this.records) {
            if (record.expiresAt <= now)
                this.records.delete(id);
        }
    }
}
/** `Uint8Array` → 无填充 base64url（32 字节固定 43 字符）。 */
function encodeBase64Url(bytes) {
    return Buffer.from(bytes).toString("base64url");
}
//# sourceMappingURL=ceremony-store.js.map