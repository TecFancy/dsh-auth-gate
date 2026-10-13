import { isSafeRelativeTarget } from "../http/index.js";
/** 挂在被包装 handler/方法上的守卫标记（幂等重包装 + 自检共用）。 */
export const GUARDED = Symbol.for("dsh-auth.guarded");
/** 登录页路径：`"deny"` 字符串分支（既有 token 门）的默认 302 目标。 */
export const LOGIN_PATH = "/auth/login";
/**
 * 浏览器导航判定（P2 §3）：只认 `Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest: document`。
 * **禁止**用 `Accept` 子串匹配（面板 fetch 的 Accept 很杂，会假绿）；两个头都缺 →
 * false（fail-closed：按 API 处理，401 而不是放行）。
 */
export function isNavigationRequest(req) {
    const mode = req.headers["sec-fetch-mode"];
    if (typeof mode === "string" && mode.toLowerCase() === "navigate")
        return true;
    const dest = req.headers["sec-fetch-dest"];
    return typeof dest === "string" && dest.toLowerCase() === "document";
}
/**
 * Location 消毒（§6）：只允许站内相对路径（`/` 开头、非 `//`、无反斜杠、无控制符）。
 * 判定与登录 `next` 共用 `shared` 的 `isSafeRelativeTarget`：同一条 302 出口纪律，
 * 控制符会让浏览器把 `"/\t/evil.com"` 解析成协议相对的站外地址（见该文件注释）。
 */
export function isSafeLocation(location) {
    return isSafeRelativeTarget(location);
}
/** auth 公共路径前缀（两种 gate 的白名单：登录/登出/状态端点免守卫）。 */
export const AUTH_PATH_PREFIX = "/auth";
/**
 * 免守卫的公开只读静态路径（精确匹配）。浏览器抓取 Web App Manifest 时按规范
 * 不带凭证（Chromium `manifest_fetcher.cc`：只有 link 带 `crossorigin="use-credentials"`
 * 才是 `kInclude`，否则 `kOmit`），cookie/Bearer 门永远认不出这次请求，登录用户
 * 也会恒 401。manifest 只含应用名/图标/显示模式等公开元数据，不含工作区信息，
 * 故列入白名单（语义与 `/auth` 同一类：不认证也必须可达）。
 */
export const PUBLIC_STATIC_PATHS = ["/manifest.webmanifest"];
/**
 * 是否命中公开只读静态路径。`kind === "upgrade"` 一律不算：这些路径只有 HTTP
 * GET 语义，放行握手只会白扩攻击面（升级请求仍走完整认证）。
 */
export function isPublicStaticPath(kind, pathname) {
    return kind !== "upgrade" && PUBLIC_STATIC_PATHS.includes(pathname);
}
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
 * 给一个 HTTP handler 套守卫。已守卫（幂等）则原样返回；deny 由守卫按 gate 给出的
 * 决策写 302/401/403，不调用原 handler；错误不捕获（交给 webserver 统一处理）。
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
        denyHttp(req, res, decision);
    });
    guarded[GUARDED] = true;
    return guarded;
}
/**
 * 给一个 upgrade handler 套守卫。**任何**非 allow 决策（含 `{deny:{upgrade:true}}`）
 * 都在 ws 协商前直接拒握手，不进入原 handler，也不为 socket 附加任何监听器。
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
/** 写一个纯文本状态响应（no-store 已由 denyHttp 统一设置）。 */
function endStatus(res, status, body) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(body);
}
/**
 * 拒绝一个 HTTP 请求，按 gate 决策渲染（P2；`decision` 缺省 = 字符串 `"deny"`）：
 * - `{deny:{redirect}}` → 302 gate 给出的目标（消毒失败则退回 LOGIN_PATH）；
 * - `{deny:{status}}` → 该 401/403；
 * - `{deny:{upgrade:true}}` → 401 兜底（正常不会落到 HTTP 面）；
 * - `"deny"`（旧门）→ 浏览器导航 302 登录页 + `next`，其余 401。
 * 一律 `cache-control: no-store`；两条 302 另加 `referrer-policy: no-referrer`：被拒的请求
 * URL 可能自带 dsh 的 launch token（`/?token=`），不加这条，浏览器跟随时会把带 token 的
 * 完整 URL 作为 Referer 送进登录页请求（进而进访问日志），绕开 `token=` 脱敏。
 */
export function denyHttp(req, res, decision = "deny") {
    if (typeof decision !== "string") {
        const payload = decision.deny;
        if ("redirect" in payload) {
            res.setHeader("cache-control", "no-store");
            res.setHeader("referrer-policy", "no-referrer");
            res.writeHead(302, {
                location: isSafeLocation(payload.redirect) ? payload.redirect : LOGIN_PATH,
            });
            res.end();
            return;
        }
        if ("status" in payload) {
            endStatus(res, payload.status, payload.status === 403 ? "forbidden" : "unauthorized");
            return;
        }
        endStatus(res, 401, "unauthorized");
        return;
    }
    if (isNavigationRequest(req)) {
        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        res.setHeader("cache-control", "no-store");
        res.setHeader("referrer-policy", "no-referrer");
        res.writeHead(302, {
            location: `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`,
        });
        res.end();
        return;
    }
    endStatus(res, 401, "unauthorized");
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
/** 把表里 handler 仍是本次 wrap 产出的守卫版本的条目换回原路由；已删除/被别人换掉的条目不动。 */
function rollbackTable(table, origins) {
    for (const [path, entry] of [...table]) {
        const origin = origins.get(entry.handler);
        if (origin !== undefined)
            table.set(path, origin);
    }
}
/**
 * 包装一个 WrappableServer：存量表 + fallback 原地换守卫，三个注册方法替换为
 * 守卫版本（增量保险，apply 顺序无关）。幂等：同一 server 第二次调用返回同一
 * unwrap。
 *
 * 返回的 unwrap 逐条回滚，不整表还原：只把 handler 仍是本次 wrap 产出的守卫版本的
 * 条目换回未守卫的原 handler（wrap 之后经包装后的 register 系方法注册的路由同样
 * 保留在表中，只摘掉守卫）；wrap 期间被拥有者卸载的条目不写回，被第三方换成别的
 * handler 的条目不碰。最后还原三个注册方法。
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
    // 仅记录本次 wrap 新产出的守卫 handler（已守卫的输入原样返回，不归本次回滚）。
    const httpOrigins = new WeakMap();
    const upgradeOrigins = new WeakMap();
    const fallbackOrigins = new WeakMap();
    const guardRoute = (route, kind = route.kind) => {
        const handler = guardHttp(gate, kind, route.handler);
        if (handler === route.handler)
            return route;
        httpOrigins.set(handler, route);
        return { ...route, handler };
    };
    const guardUpgradeRoute = (route) => {
        const handler = guardUpgrade(gate, route.handler);
        if (handler === route.handler)
            return route;
        upgradeOrigins.set(handler, route);
        return { ...route, handler };
    };
    const guardFallback = (handler) => {
        const guarded = guardHttp(gate, "fallback", handler);
        if (guarded !== handler)
            fallbackOrigins.set(guarded, handler);
        return guarded;
    };
    for (const [path, route] of server.exact)
        server.exact.set(path, guardRoute(route, "exact"));
    for (const [path, route] of server.prefixes)
        server.prefixes.set(path, guardRoute(route));
    for (const [path, route] of server.upgrades)
        server.upgrades.set(path, guardUpgradeRoute(route));
    if (server.fallback !== undefined)
        server.fallback = guardFallback(server.fallback);
    const register = ((route) => original.register(guardRoute(route)));
    const registerUpgrade = ((route) => original.registerUpgrade(guardUpgradeRoute(route)));
    const registerFallback = ((handler) => original.registerFallback(guardFallback(handler)));
    register[GUARDED] = true;
    registerUpgrade[GUARDED] = true;
    registerFallback[GUARDED] = true;
    server.register = register;
    server.registerUpgrade = registerUpgrade;
    server.registerFallback = registerFallback;
    const unwrap = () => {
        rollbackTable(server.exact, httpOrigins);
        rollbackTable(server.prefixes, httpOrigins);
        rollbackTable(server.upgrades, upgradeOrigins);
        const fallbackOrigin = server.fallback === undefined ? undefined : fallbackOrigins.get(server.fallback);
        if (fallbackOrigin !== undefined)
            server.fallback = fallbackOrigin;
        server.register = original.register;
        server.registerUpgrade = original.registerUpgrade;
        server.registerFallback = original.registerFallback;
        unwrappers.delete(server);
    };
    unwrappers.set(server, unwrap);
    return unwrap;
}
//# sourceMappingURL=guard.js.map