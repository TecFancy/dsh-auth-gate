/**
 * `POST/GET /auth/login` 端点的测试支撑（**只被测试 import，产品代码不引用**）。
 *
 * 从 `password-endpoints.login.test.ts` 抽出来是因为两个测试文件（登录主流程 + notice 白名单）
 * 都需要同一套 fake req/res 与 deps 装配，而单个测试文件有 250 有效行上限。
 */
import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpHandler } from "../../gate/index.js";
import type { PasswordEndpointsDeps } from "./password-endpoints.js";
import { LoginRateLimiter } from "../../shared/index.js";
import { SessionStore, type Session } from "../../session/index.js";
declare class MemTable implements KvTable<string, Session> {
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
export interface VerifyCall {
    storedHash: string;
    password: string;
}
export interface Harness {
    deps: PasswordEndpointsDeps;
    routes: {
        kind: "exact" | "prefix";
        path: string;
        handler: HttpHandler;
    }[];
    table: MemTable;
    logs: {
        level: string;
        message: unknown;
    }[];
    verifyCalls: VerifyCall[];
    setStore(value: SessionStore | undefined): void;
    setUsers(users: Map<string, {
        passwordHash: string;
        disabled: boolean;
    }>): void;
    setLoadError(error: Error): void;
    setMissing(): void;
    limiter: LoginRateLimiter;
}
export declare function makeHarness(): Harness;
export declare function handlerOf(harness: Harness, kind: "exact" | "prefix", path: string): HttpHandler;
export declare function loginReq(body: string, remoteAddress?: string, url?: string): IncomingMessage;
/** GET /auth/login 请求（无 body；notice 只可能出现在 query 上）。 */
export declare function loginGetReq(url: string, cookie?: string): IncomingMessage;
export {};
//# sourceMappingURL=password-endpoints-login-harness.d.ts.map