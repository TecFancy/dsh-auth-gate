import { type KvTable } from "@deepseek-ai/dsh-storage-domain";
/** 会话 cookie 属性（M2 起使用；M1 冻结并测试）。 */
export declare const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";
/**
 * 精确输出 `<name>=<token>; Max-Age=<secs>; Path=/; HttpOnly; Secure; SameSite=Lax`；
 * `secure=false` 时省略 `; Secure`（http 测试/开发，M7）。
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
}
export interface IssuedSession {
    token: string;
    session: Session;
}
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
        }>;
    };
};
/** 对一张 KvTable 编程的会话存储；domain 的 open/close 由 index.ts 接线。 */
export declare class SessionStore {
    private readonly table;
    constructor(table: KvTable<string, Session>);
    create(subject: string, ttlMs: number): Promise<IssuedSession>;
    /** 同步内存读 + 校验；有效则返回行（不修改），否则 undefined。 */
    getByToken(token: string): Session | undefined;
    /** 吊销 = 删除行（登出语义，写盘）；不存在返回 false。 */
    revokeByToken(token: string): Promise<boolean>;
    /** 全表扫描删除过期行，返回删除数。 */
    pruneExpired(now?: number): Promise<number>;
}
//# sourceMappingURL=session-store.d.ts.map