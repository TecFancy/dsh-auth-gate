import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LoginRateLimiter } from "../../shared/index.js";
import type { UserRecord } from "../../shared/index.js";
import { SessionStore, type Session } from "../../session/index.js";
import type { AdminAuditEvent } from "./audit.js";
import type { AdminDeps } from "./deps.js";
/**
 * admin 切片测试夹具（切片内，非 *.test.ts）。依赖全部可注入 + 真实 `SessionStore`（内存表），
 * 会话定位/吊销走真实实现；`mutateUsers` 默认打内存 map，需要真文件时由用例覆盖。
 */
export declare class MemTable implements KvTable<string, Session> {
    private readonly map;
    get size(): number;
    get(key: string): Session | undefined;
    entries(): IterableIterator<[string, Session]>;
    keys(): IterableIterator<string>;
    put(key: string, value: Session): Promise<void>;
    delete(key: string): Promise<boolean>;
    update(key: string, fn: (current: Session) => Session): Promise<Session>;
}
export interface FakeRes {
    res: ServerResponse;
    status: number | undefined;
    headers: Record<string, string>;
    body: string;
}
export declare function makeRes(): FakeRes;
export interface ReqOptions {
    method?: string;
    /** 缺省 = `dsh_auth=admin`；`null` = 不带 Cookie 头。 */
    cookie?: string | null;
    contentType?: string | null;
    body?: string | Buffer;
    origin?: string | null;
    secFetchSite?: string | null;
    host?: string;
    encrypted?: boolean;
}
export declare function makeReq(options?: ReqOptions): IncomingMessage;
export declare function form(values: Record<string, string>): string;
/** JSON.parse 返回 any：先落 unknown 再断言（recommendedTypeChecked 禁 unsafe-argument）。 */
export declare function jsonBody(res: FakeRes): unknown;
export declare function adminUser(overrides?: Partial<UserRecord>): UserRecord;
export declare function session(subject: string, kind?: Session["kind"]): Session;
export interface Harness {
    deps: AdminDeps;
    store: SessionStore;
    users: Map<string, UserRecord>;
    sessions: Map<string, Session>;
    logs: {
        level: string;
        message: unknown;
    }[];
    revokes: string[];
    cleared: string[];
    hashCalls: string[];
    totpCalls: string[];
    readonly loadCalls: number;
    limiter: LoginRateLimiter;
    /** 审计事件（logger 入参里带 `event` 字符串的那些）。 */
    audits(): AdminAuditEvent[];
}
export declare function makeHarness(overrides?: Partial<AdminDeps>): Harness;
//# sourceMappingURL=test-harness.d.ts.map