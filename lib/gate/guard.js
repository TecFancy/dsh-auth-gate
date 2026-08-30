/** 挂在被包装 handler/方法上的守卫标记（幂等重包装 + 自检共用）。 */
export const GUARDED = Symbol.for("dsh-auth.guarded");
/** 登录页路径（拒绝时 302 的目标）。 */
export const LOGIN_PATH = "/auth/login";
/** auth 公共路径前缀（两种 gate 的白名单：登录/登出/状态端点免守卫）。 */
export const AUTH_PATH_PREFIX = "/auth";
/** 认证本地代理（`dsh-auth-proxy --mark-proxy`）附加的请求标记头。 */
export const PROXY_MARKER_HEADER = "x-dsh-proxy";
/**
 * 代理链路下会被 dsh /api 围栏判定为 loopback、但语义属于"远程可控宿主/侦察"
 * 的方法：经代理（携带标记头）的请求对这些方法直接 403，作为本地代理场景的
 * 安全边界收口。其余方法（settings 与 credentials 域的读写）经认证后正常放行。
 * 注意：生效前提是代理开启 `--mark-proxy`；无标记头时行为与未部署代理完全一致。
 */
const PROXY_DENIED_METHODS = new Set([
    "host.pickDirectory",
    "host.openPath",
    "settings.openDocument",
    "llm.discoverModels",
]);
/** 是否命中"代理标记 + 禁行方法"：`/api/<method>` 路径上带 `X-Dsh-Proxy: 1`。 */
export function isProxyDeniedRequest(req, pathname) {
    if (req.headers[PROXY_MARKER_HEADER] !== "1")
        return false;
    if (!pathname.startsWith("/api/"))
        return false;
    return PROXY_DENIED_METHODS.has(pathname.slice(5));
}
export function isGuarded(target) {
    return target[GUARDED] === true;
}
/**
 * 给一个 HTTP handler 套守卫。已守卫（幂等）则原样返回；deny 由守卫写
 * 302/401，不调用原 handler；错误不捕获（交给 webserver 统一处理）。
 */
export function guardHttp(gate, kind, handler) {
    if (isGuarded(handler))
        return handler;
    const guarded = (async (req, res) => {
        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        const decision = await gate().decide(req, kind, pathname);
        if (decision === "allow") {
            if (isProxyDeniedRequest(req, pathname)) {
                denyForbidden(res);
                return;
            }
            await handler(req, res);
            return;
        }
        denyHttp(req, res);
    });
    guarded[GUARDED] = true;
    return guarded;
}
/**
 * 给一个 upgrade handler 套守卫。deny 在 ws 协商前直接拒握手，不进入
 * 原 handler，也不为 socket 附加任何监听器。
 */
export function guardUpgrade(gate, handler) {
    if (isGuarded(handler))
        return handler;
    const guarded = (async (req, socket, head) => {
        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        const decision = await gate().decide(req, "upgrade", pathname);
        if (decision === "allow") {
            await handler(req, socket, head);
            return;
        }
        denyUpgrade(socket);
    });
    guarded[GUARDED] = true;
    return guarded;
}
/**
 * 拒绝一个 HTTP 请求：浏览器导航（GET 且 Accept 含 text/html）→ 302 登录页
 * （带 next 回跳）；其余 → 401。两者都禁缓存。
 */
export function denyHttp(req, res) {
    res.setHeader("cache-control", "no-store");
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const wantsPage = req.method === "GET" && String(req.headers.accept ?? "").includes("text/html");
    if (wantsPage) {
        res.writeHead(302, {
            location: `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`,
        });
        res.end();
        return;
    }
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("unauthorized");
}
/** 拒绝一个 WS 升级：写 401 响应行后销毁 socket，不进入 ws 协商。 */
export function denyUpgrade(socket) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
}
/** 403 拒绝（代理标记命中）：与 dsh /api 围栏同形（forbidden），禁缓存。 */
export function denyForbidden(res) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
}
const unwrappers = new WeakMap();
/**
 * 包装一个 WrappableServer：存量表 + fallback 原地换守卫，三个注册方法替换为
 * 守卫版本（增量保险，apply 顺序无关）。幂等：同一 server 第二次调用返回同一
 * unwrap。返回的 unwrap 整体回滚（快照 + 原方法）。
 */
export function wrapServer(server, gate, log) {
    // 规格冻结签名：log 预留给诊断；包装/还原本身静默（自检在 index.ts 负责）。
    void log;
    const existing = unwrappers.get(server);
    if (existing !== undefined)
        return existing;
    const original = {
        register: server.register.bind(server),
        registerUpgrade: server.registerUpgrade.bind(server),
        registerFallback: server.registerFallback.bind(server),
    };
    const snapshot = {
        exact: new Map(server.exact),
        prefixes: new Map(server.prefixes),
        upgrades: new Map(server.upgrades),
        fallback: server.fallback,
    };
    for (const [path, route] of server.exact) {
        server.exact.set(path, { ...route, handler: guardHttp(gate, "exact", route.handler) });
    }
    for (const [path, route] of server.prefixes) {
        server.prefixes.set(path, {
            ...route,
            handler: guardHttp(gate, route.kind, route.handler),
        });
    }
    for (const [path, route] of server.upgrades) {
        server.upgrades.set(path, { ...route, handler: guardUpgrade(gate, route.handler) });
    }
    if (server.fallback !== undefined) {
        server.fallback = guardHttp(gate, "fallback", server.fallback);
    }
    const register = ((route) => original.register({
        ...route,
        handler: guardHttp(gate, route.kind, route.handler),
    }));
    const registerUpgrade = ((route) => original.registerUpgrade({
        ...route,
        handler: guardUpgrade(gate, route.handler),
    }));
    const registerFallback = ((handler) => original.registerFallback(guardHttp(gate, "fallback", handler)));
    register[GUARDED] = true;
    registerUpgrade[GUARDED] = true;
    registerFallback[GUARDED] = true;
    server.register = register;
    server.registerUpgrade = registerUpgrade;
    server.registerFallback = registerFallback;
    const unwrap = () => {
        server.exact.clear();
        for (const [path, route] of snapshot.exact)
            server.exact.set(path, route);
        server.prefixes.clear();
        for (const [path, route] of snapshot.prefixes)
            server.prefixes.set(path, route);
        server.upgrades.clear();
        for (const [path, route] of snapshot.upgrades)
            server.upgrades.set(path, route);
        server.fallback = snapshot.fallback;
        server.register = original.register;
        server.registerUpgrade = original.registerUpgrade;
        server.registerFallback = original.registerFallback;
        unwrappers.delete(server);
    };
    unwrappers.set(server, unwrap);
    return unwrap;
}
//# sourceMappingURL=guard.js.map