import { LoginRateLimiter } from "../../shared/index.js";
import { SessionStore } from "../../session/index.js";
class MemTable {
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
    const res = {
        setHeader: (name, value) => {
            state.headers[name.toLowerCase()] = String(value);
        },
        writeHead: (status, extra) => {
            state.status = status;
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
export function makeHarness() {
    const routes = [];
    const table = new MemTable();
    const logs = [];
    const verifyCalls = [];
    let store = new SessionStore(table);
    let users = new Map([["alice", { passwordHash: "h-alice", disabled: false }]]);
    let loadError;
    let missing = false;
    const limiter = new LoginRateLimiter({ now: () => 1_000_000 });
    return {
        routes,
        table,
        logs,
        verifyCalls,
        setStore: (value) => {
            store = value;
        },
        setUsers: (value) => {
            users = value;
        },
        setLoadError: (error) => {
            loadError = error;
        },
        setMissing: () => {
            missing = true;
        },
        limiter,
        deps: {
            register: (route) => {
                routes.push(route);
                return () => {
                    const at = routes.indexOf(route);
                    if (at !== -1)
                        routes.splice(at, 1);
                };
            },
            sessions: () => store,
            cookieName: "dsh_auth",
            cookieSecure: false,
            sessionTtl: 604800,
            logoutOrder: 1000,
            usersPath: "/tmp/users.yaml",
            loadUsers: () => {
                if (loadError !== undefined)
                    return Promise.reject(loadError);
                const empty = new Map();
                return Promise.resolve({ snapshot: { users: missing ? empty : users }, missing });
            },
            verify: (password, storedHash) => {
                verifyCalls.push({ storedHash, password });
                return Promise.resolve(password === "pw" && storedHash === "h-alice");
            },
            totpMode: "off",
            verifyTotp: () => undefined,
            replayCheck: () => true,
            now: () => 1_700_000_000_000,
            challengeMacKey: Buffer.alloc(32, 7), // D10 测试密钥
            limiter,
            logger: {
                error: (message) => logs.push({ level: "error", message }),
                info: (message) => logs.push({ level: "info", message }),
                warn: (message) => logs.push({ level: "warn", message }),
            },
        },
    };
}
export function handlerOf(harness, kind, path) {
    const route = harness.routes.find((r) => r.kind === kind && r.path === path);
    if (route === undefined)
        throw new Error(`route not found: ${kind} ${path}`);
    return route.handler;
}
export function loginReq(body, remoteAddress = "127.0.0.1", url = "/auth/login") {
    return {
        method: "POST",
        url,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        socket: { remoteAddress },
        *[Symbol.asyncIterator]() {
            yield Buffer.from(body);
        },
    };
}
/** GET /auth/login 请求（无 body；notice 只可能出现在 query 上）。 */
export function loginGetReq(url, cookie) {
    return {
        method: "GET",
        url,
        headers: cookie === undefined ? {} : { cookie },
        socket: { remoteAddress: "127.0.0.1" },
    };
}
//# sourceMappingURL=password-endpoints-login-harness.js.map