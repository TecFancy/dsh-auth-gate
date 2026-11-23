import { hasRouteAuthModel } from "./host-auth-wiring.js";
import { buildCookie, parseCookieHeader } from "./host/shared/http/index.js";
import { readLaunchToken } from "./launch-token-bridge.js";
/**
 * 放行后重铸宿主浏览器 cookie 的接线（D37）。
 *
 * 背景：dsh 自己有第二层 cookie（`dsh-auth-<sha256(authority)>`，`SameSite=Strict`，默认 30 天），
 * 由 `client-connection` 在 `GET /?token=<launchToken>` 时签发，名字与签名都绑定请求的 Host。
 * 本插件的门只看自己的 `dsh_auth`，放行之后不再检查宿主那一层，于是出现「门放行、宿主 401」：
 * 用户看到的是宿主那句 `dsh web authentication required`，而不是登录页。触发条件不止一种
 * （反代改写 Host、换域名/端口、宿主 cookie 过期、清站点数据），共同点是**外层会话仍然有效**。
 *
 * 接缝：宿主 `connection` 服务暴露了 `requestRejection(request)`，官方描述是「把 Connection 的
 * Host/Origin 检查与浏览器认证应用到另一条 Web 路由」。它只读请求头、不写响应，正好可以在
 * 放行之后问一次「宿主认不认这次请求」。不复制宿主的 cookie 格式与 HMAC：那是未冻结的内部
 * 实现，dsh 一改就会静默失效（issue #69 的维护者结论）。
 *
 * 防循环：重铸的 302 指向 `/?token=<launchToken>`，宿主在那里签发 cookie 并 303 回 `./`。
 * 若宿主仍然不认（token 过期、多副本、cookie 被拒），第二次请求会再次命中本钩子。所以每次
 * 重铸都随 302 下发一枚一次性标记 cookie，标记还在时不再重铸，直接放行让宿主自己回 401：
 * 一次失败的重铸最多多一跳，不会变成重定向环。
 */
/** 一次性标记的 cookie 名：与 `dsh_auth` 分开，避免任何会话解析路径读到它。 */
export const REBRIDGE_MARKER_COOKIE = "dsh_auth_rebridge";
/** 标记寿命（秒）：只覆盖「302 → 宿主签发 → 303 回 `./`」这一跳，取 60 秒足够且不残留。 */
const MARKER_TTL_SECONDS = 60;
/**
 * 标记值：只表示「刚刚重铸过一次」。它不携带任何身份信息，也不参与任何判定，所以是常量；
 * 用随机值反而会让人误以为它是一枚可校验的凭据。
 */
const MARKER_VALUE = "1";
/**
 * 装好重铸钩子。
 *
 * 返回的钩子只对「顶层文档导航 + 首页」生效：`GET`、`Sec-Fetch-Dest: document`（或
 * `Sec-Fetch-Mode: navigate`）、pathname 为 `/`。其余请求（`/api`、静态资源、`/plugins`、
 * WebSocket）一律不重铸：它们要么不是导航（302 到 `/?token=` 对 fetch 没有意义），要么
 * 重铸后仍然拿不到 cookie，只会把一次 401 变成一次无用的往返。
 *
 * 宿主回 `401`（未认证）且没有标记时，返回 302 到相对 `/?token=` 并
 * 下发标记；其余情况返回 `undefined`（照常放行）。取不到 launch token 时也不重铸：没有 token
 * 的 `/?token=` 只会被宿主再拒一次。
 *
 * @param ctx - 宿主上下文；`connection` 每次询问时现取（服务可能晚于本行就绪）。
 * @param config - cookie 属性来源（`cookieSecure` 与 `dsh_auth` 保持一致）。
 * @param log - 诊断日志；重铸成功与停用各记一次，不记录 token 本身。
 * @returns 交给 `wrapServer` 的放行后钩子。
 */
export function makeRebridge(ctx, config, log) {
    let warnedInactive = false;
    return (req, kind, pathname) => {
        if (!isRebridgeCandidate(req, kind, pathname))
            return undefined;
        // 0.2.3-alpha.2：宿主 cookie 不再是登录的必要条件（本插件注册的
        // `connection.authentication` Provider 用自身会话换 Peer），那张 30 天 cookie 也只影响
        // 宿主自己的索引渲染，而索引渲染此时已被 fallback 鉴权适配器覆盖。这一代没有
        // `requestRejection` 接缝，钩子安静停用，不打「接缝缺失」告警（那不是退化）。
        if (hasRouteAuthModel(ctx))
            return undefined;
        const probe = connectionProbe(ctx);
        if (probe === undefined) {
            if (!warnedInactive) {
                warnedInactive = true;
                log.warn("host-cookie rebridge inactive: no connection.requestRejection (dsh without the documented seam?)");
            }
            return undefined;
        }
        if (hostRejection(probe, req) !== 401)
            return undefined;
        if (parseCookieHeader(req.headers.cookie, REBRIDGE_MARKER_COOKIE) !== undefined) {
            // 已经重铸过一次仍然被拒：不再跳，让宿主自己回 401，避免重定向环。
            log.warn("host-cookie rebridge did not take effect; leaving the host 401 in place");
            return undefined;
        }
        const token = readLaunchToken(ctx);
        if (token === undefined)
            return undefined;
        log.info("host-cookie rebridge: redirecting to the launch-token exchange");
        return {
            location: `/?token=${encodeURIComponent(token)}`,
            setCookie: buildCookie(REBRIDGE_MARKER_COOKIE, MARKER_VALUE, MARKER_TTL_SECONDS, config.cookieSecure),
        };
    };
}
/**
 * 是否值得重铸：只认顶层文档导航到首页。
 *
 * 用 `Sec-Fetch-Dest: document` 或 `Sec-Fetch-Mode: navigate` 判定（与门自己的导航判定同一套
 * 头，见 `isNavigationRequest`），但**不**复用那个函数，因为这里要的是更窄的条件：重铸只对
 * 「浏览器会跟着 302 走」的请求有意义，而 `isNavigationRequest` 还覆盖了表单 POST 等场景。
 * 两个头都缺时返回 false（fail-closed：不重铸，保持现有行为）。
 */
function isRebridgeCandidate(req, kind, pathname) {
    if (kind === "upgrade")
        return false;
    if (req.method !== "GET")
        return false;
    if (pathname !== "/")
        return false;
    if (carriesLaunchToken(req.url))
        return false;
    const dest = req.headers["sec-fetch-dest"];
    if (typeof dest === "string" && dest.toLowerCase() === "document")
        return true;
    const mode = req.headers["sec-fetch-mode"];
    return typeof mode === "string" && mode.toLowerCase() === "navigate";
}
/**
 * 请求 URL 上是否已经带着宿主的 `token` query。
 *
 * 带了就不能重铸：那一跳正是宿主在签发 cookie 的地方（登录桥每次登录都会把浏览器送到
 * `/?token=<launchToken>`），此时 `dsh_auth` 已生效而宿主 cookie 还没签发，
 * `requestRejection` 必然回 401。重铸会 302 到**同一个地址**，除了把 token 多写进一个
 * `Location` 头、每次登录多一跳之外没有任何收益；标记 cookie 一旦没被保存还会变成自指 302。
 *
 * 宿主 `authorizeIndex` 只认 `pathname === "/"` 且恰好一个 `token`，而调用方已先判过
 * `pathname` 是 `/`，所以这里只查 query 即可。
 */
function carriesLaunchToken(url) {
    try {
        return new URL(url ?? "/", "http://x").searchParams.has("token");
    }
    catch {
        // 解析不了的 URL 一律当作「带着 token」：宁可不重铸，也不制造自指重定向。
        return true;
    }
}
/**
 * 宿主怎么判这次请求：`401` 未认证、`403` Host/Origin 围栏拒绝、`undefined` 放行。
 *
 * 只有 `401` 值得重铸：`403` 说明这个部署不认这个 authority（`trustedHosts` 没配到），换成
 * `/?token=` 走到同一个围栏上还是 `403`，重铸只会把一次清楚的 403 变成一次白跑的 302。
 *
 * `requestRejection` 抛错按 `401` 处理：钩子的契约是绝不把异常抛给守卫，而这里抛错说明宿主
 * 那一层本身出了问题，重铸一次是唯一可能自愈的动作。
 */
function hostRejection(probe, req) {
    try {
        return probe.requestRejection({ headers: req.headers });
    }
    catch {
        return 401;
    }
}
/** 现取宿主 `connection` 服务；缺失或没有 `requestRejection` 时返回 undefined。 */
function connectionProbe(ctx) {
    const connection = ctx.get("connection");
    if (connection === undefined || typeof connection.requestRejection !== "function") {
        return undefined;
    }
    return connection;
}
