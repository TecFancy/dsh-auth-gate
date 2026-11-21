import { type KvTable } from "@deepseek-ai/dsh-storage-domain";
import { type SessionKind } from "../../../shared/protocol/index.js";
/** 会话 cookie 属性（M2 起使用；M1 冻结并测试）。 */
export declare const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";
/**
 * 精确输出 `<name>=<token>; Max-Age=<secs>; Path=/; HttpOnly; Secure; SameSite=Lax`；
 * `secure=false` 时省略 `; Secure`（http 测试/开发，M7）。
 *
 * 属性模板只有一份，在 `shared/http` 的 `buildCookie`：重铸标记与它会话 cookie 共用同一组
 * 属性，避免两处各写一遍后漂移。本函数保留名字与签名，因为 M1/M2 的冻结测试钉的是它。
 */
export declare function buildSetCookie(cookieName: string, token: string, maxAgeSeconds: number, secure?: boolean): string;
/** 会话 token 的落盘键：sha256 hex 小写（64 字符）；介质上永不出现原始 token。 */
export declare function digestToken(token: string): string;
export interface Session {
    /** 审计用：产生该会话的凭证身份（M1 恒 "token"，M2 为用户名）。 */
    subject: string;
    /** epoch ms。 */
    createdAt: number;
    /** epoch ms。 */
    expiresAt: number;
    revoked: boolean;
    /**
     * 会话类别（P2 ④，类型在跨半边契约 D31）：`full` = 常规会话；`password-change-only` =
     * 受限会话，仅由「登录时用户带 `must_change_password`」签发，TTL 短且入口受限。
     * 缺省 = `full`（旧行无此字段仍解析）。
     */
    kind?: SessionKind | undefined;
    /**
     * 签发时读到的 `password_changed_at`（credential version）。扫描器据此吊销"用旧口令
     * 认证出来的会话"：签发时刻可能晚于改密时间戳（校验跨越了等待），时间戳比较漏掉的
     * 正是这条竞态。旧行没有该字段 → 视为旧凭证。
     */
    credentialVersion?: string | undefined;
}
export interface IssuedSession {
    token: string;
    session: Session;
}
/**
 * 是否 bootstrap 会话（只读 `kind`；缺省 / 其它类别一律 false）。
 * 门用它把「只放行 `/auth/*`」的临时会话与正式会话分开，不做任何 IO。
 */
export declare function isBootstrapSession(session: Session | undefined): boolean;
/** 键 = digest（sha256 hex），不进 row；row 只存以上四字段。 */
export declare const sessionDomainSpec: {
    name: string;
    version: number;
    tables: {
        sessions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            subject: string;
            createdAt: number;
            expiresAt: number;
            revoked: boolean;
            kind?: "full" | "password-change-only" | "bootstrap" | undefined;
            credentialVersion?: string | undefined;
        }>;
    };
};
/** 缺省过期行清扫间隔（毫秒）：`create` 至多每 60s 触发一次全表扫描。 */
export declare const DEFAULT_PRUNE_INTERVAL_MS = 60000;
/** 会话存储的可选项（时钟注入供测试钉住清扫节奏）。 */
export interface SessionStoreOptions {
    /** 过期行清扫的最小间隔（毫秒）；缺省 `DEFAULT_PRUNE_INTERVAL_MS`。 */
    pruneIntervalMs?: number;
    /** 时钟（epoch ms）；缺省 `Date.now`。 */
    now?: () => number;
}
/** 对一张 KvTable 编程的会话存储；domain 的 open/close 由 index.ts 接线。 */
export declare class SessionStore {
    private readonly table;
    private readonly pruneIntervalMs;
    private readonly now;
    /** 上次清扫时刻；`-Infinity` = 还没扫过（首次 create 必扫）。 */
    private lastPruneAt;
    constructor(table: KvTable<string, Session>, options?: SessionStoreOptions);
    create(subject: string, ttlMs: number, kind?: SessionKind, credentialVersion?: string): Promise<IssuedSession>;
    /** 同步内存读 + 校验；有效则返回行（不修改），否则 undefined。 */
    getByToken(token: string): Session | undefined;
    /** 吊销 = 删除行（登出语义，写盘）；不存在返回 false。 */
    revokeByToken(token: string): Promise<boolean>;
    /**
     * 吊销某个 subject（用户名）的**全部**会话行，返回吊销条数（写盘）。
     * 用途：`dsh-auth user disable` 之后，已发 cookie / Bearer token 立即失效；
     * 行内没有主体索引，故按 row.subject 全表扫描（会话量级为单机用户数，成本可忽略）。
     */
    revokeBySubject(subject: string): Promise<number>;
    /**
     * 吊销某 subject 下**凭证版本不等于** `currentVersion` 的会话行（口令变更后调用）。
     *
     * 判定不看 `createdAt`：登录的哈希校验跨越 await，可能在改密之后才签发会话：按时间
     * 比较会把它当成"新会话"留下。记录签发时读到的版本才能精确吊销"用旧口令认证出来的"
     * 那一条，同时保留改密后重新登录签发的会话（版本已是最新）。旧行没有版本字段，
     * 视为旧凭证，一并吊销。返回吊销条数。
     */
    revokeByCredentialVersion(subject: string, currentVersion: string): Promise<number>;
    /**
     * 吊销某个类别的**全部**会话行，返回吊销条数（写盘）。
     * 用途：首次配置向导成功后关掉引导窗口（`bootstrap` 会话一律失效）。
     * 行内没有类别索引，故按 row.kind 全表扫描（与 `revokeBySubject` 同款理由）。
     */
    revokeByKind(kind: SessionKind): Promise<number>;
    /**
     * 出现过**非引导**会话的 subject 去重集合（无序）。供扫描器找出已从 users.yaml
     * 删除的用户的残留会话；bootstrap 引导会话不属于任何用户，故按 kind 排除。
     */
    subjects(): string[];
    /** 全表扫描删除过期行，返回删除数。 */
    pruneExpired(now?: number): Promise<number>;
    /** 距上次清扫不足 `pruneIntervalMs` → 0；否则记下本次时刻并清扫（并发 create 只有一个真扫）。 */
    private pruneIfDue;
    /** 先收集键再单批删除：不在迭代中删除，且整批只占一个写槽。 */
    private deleteWhere;
}
