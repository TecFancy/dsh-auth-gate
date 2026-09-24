import { LoginRateLimiter } from "../../shared/index.js";
import { digestToken, SessionStore } from "../../session/index.js";
/**
 * admin 切片测试夹具（切片内，非 *.test.ts）。依赖全部可注入 + 真实 `SessionStore`（内存表），
 * 会话定位/吊销走真实实现；`mutateUsers` 默认打内存 map，需要真文件时由用例覆盖。
 */
export class MemTable {
    map = new Map();
    get size() {
        return this.map.size;
    }
    get(key) {
        return this.map.get(key);
    }
    entries() {
        return this.map.entries();
    }
    keys() {
        return this.map.keys();
    }
    put(key, value) {
        this.map.set(key, value);
        return Promise.resolve();
    }
    delete(key) {
        return Promise.resolve(this.map.delete(key));
    }
    update(key, fn) {
        const current = this.map.get(key);
        if (current === undefined)
            throw new Error("missing-key");
        const next = fn(current);
        this.map.set(key, next);
        return Promise.resolve(next);
    }
}
export function makeRes() {
    const state = {
        status: undefined,
        headers: {},
        body: "",
    };
    let sent = false;
    const res = {
        setHeader: (name, value) => {
            if (sent)
                throw new Error("ERR_HTTP_HEADERS_SENT: setHeader after writeHead");
            state.headers[name.toLowerCase()] = String(value);
        },
        writeHead: (status, extra) => {
            if (sent)
                throw new Error("ERR_HTTP_HEADERS_SENT: writeHead called twice");
            state.status = status;
            sent = true;
            for (const [name, value] of Object.entries(extra ?? {})) {
                state.headers[name.toLowerCase()] = String(value);
            }
        },
        end: (body) => {
            state.body = body ?? "";
        },
    };
    return Object.assign(state, { res });
}
export function makeReq(options = {}) {
    const cookie = options.cookie === undefined ? "dsh_auth=admin" : options.cookie;
    const contentType = options.contentType === undefined ? "application/x-www-form-urlencoded" : options.contentType;
    return {
        method: options.method ?? "POST",
        url: "/auth/users/password",
        headers: {
            ...(contentType === null ? {} : { "content-type": contentType }),
            ...(cookie === null ? {} : { cookie }),
            ...(options.origin === undefined || options.origin === null
                ? {}
                : { origin: options.origin }),
            ...(options.secFetchSite === undefined || options.secFetchSite === null
                ? {}
                : { "sec-fetch-site": options.secFetchSite }),
            ...(options.host === undefined ? {} : { host: options.host }),
        },
        socket: { remoteAddress: "127.0.0.1", encrypted: options.encrypted === true },
        *[Symbol.asyncIterator]() {
            if (options.body !== undefined)
                yield Buffer.from(options.body);
        },
    };
}
export function form(values) {
    return new URLSearchParams(values).toString();
}
/** JSON.parse 返回 any：先落 unknown 再断言（recommendedTypeChecked 禁 unsafe-argument）。 */
export function jsonBody(res) {
    const parsed = JSON.parse(res.body);
    return parsed;
}
export function adminUser(overrides = {}) {
    return { passwordHash: "hash-old", disabled: false, role: "admin", ...overrides };
}
export function session(subject, kind) {
    return { subject, createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, revoked: false, kind };
}
function seedUsers() {
    return new Map([
        ["admin", adminUser()],
        ["totpadmin", adminUser({ totpSecret: "TOTP-SECRET" })],
        ["alice", { passwordHash: "hash-alice", disabled: false, role: "user" }],
    ]);
}
function seedSessions(table) {
    // 键 = 原始会话 token（cookie 值），表键 = digest(token)：与 SessionStore.getByToken 对齐。
    const sessions = new Map([
        ["admin", session("admin")],
        ["alice", session("alice")],
        ["totpadmin", session("totpadmin")],
        ["restricted", session("admin", "password-change-only")],
    ]);
    // 落盘键 = digest(raw token)（SessionStore.getByToken 按 digest 查表，见 M1）。
    for (const [token, value] of sessions)
        void table.put(digestToken(token), value);
    return sessions;
}
function buildDeps(counters, users, sessions, store, overrides) {
    return {
        sessions: () => store,
        cookieName: "dsh_auth",
        loadUsers: () => {
            counters.loadCalls += 1;
            return Promise.resolve({ users });
        },
        mutateUsers: async (mutator) => {
            await mutator({ users });
        },
        hash: (password) => {
            counters.hashCalls.push(password);
            return Promise.resolve(`scrypt$stub$${password.length}`);
        },
        verify: (password, hash) => Promise.resolve(hash === "hash-old" && password === "old-pw-1!"),
        verifyTotp: (secret, code) => {
            counters.totpCalls.push(code);
            return code === "123456" && secret !== "" ? 7 : undefined;
        },
        replayCheck: () => true,
        clientIp: () => "127.0.0.1",
        publicHost: "dsh.example.com",
        limiter: new LoginRateLimiter(),
        revokeSubject: async (subject) => {
            counters.revokes.push(subject);
            for (const [token, value] of sessions) {
                if (value.subject === subject)
                    sessions.delete(token);
            }
            // 真实 API：按 row.subject 全表扫描删除（覆盖测试侧直接 create 出来的会话）。
            await store.revokeBySubject(subject);
            return true;
        },
        clearRateBuckets: (subject) => counters.cleared.push(subject),
        now: () => 1_700_000_000_000,
        logger: {
            info: (message) => counters.logs.push({ level: "info", message }),
            error: (message) => counters.logs.push({ level: "error", message }),
        },
        ...overrides,
    };
}
/** 审计事件筛选：logger 入参里 `event` 以 `audit.` 开头的对象。 */
function collectAudits(logs) {
    const events = [];
    for (const entry of logs) {
        const message = entry.message;
        if (typeof message !== "object" || message === null || !("event" in message))
            continue;
        const event = message.event;
        if (typeof event === "string" && event.startsWith("audit.")) {
            events.push(message);
        }
    }
    return events;
}
export function makeHarness(overrides = {}) {
    const table = new MemTable();
    const store = new SessionStore(table);
    const counters = {
        logs: [],
        revokes: [],
        cleared: [],
        hashCalls: [],
        totpCalls: [],
        loadCalls: 0,
    };
    const users = seedUsers();
    const sessions = seedSessions(table);
    const deps = buildDeps(counters, users, sessions, store, overrides);
    return {
        deps,
        store,
        users,
        sessions,
        logs: counters.logs,
        revokes: counters.revokes,
        cleared: counters.cleared,
        hashCalls: counters.hashCalls,
        totpCalls: counters.totpCalls,
        get loadCalls() {
            return counters.loadCalls;
        },
        limiter: deps.limiter,
        audits: () => collectAudits(counters.logs),
    };
}
//# sourceMappingURL=test-harness.js.map