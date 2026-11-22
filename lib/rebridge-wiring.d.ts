import type { Context } from "@deepseek-ai/cordis";
import type { AdmitRebridge } from "./host/shared/guard/index.js";
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
export declare const REBRIDGE_MARKER_COOKIE = "dsh_auth_rebridge";
/** 钩子需要的配置子集（结构兼容 `AuthConfig`）。 */
export interface RebridgeConfig {
    readonly cookieSecure: boolean;
}
/** 钩子需要的日志表面。 */
export interface RebridgeLog {
    warn(message: unknown): void;
    info(message: unknown): void;
}
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
export declare function makeRebridge(ctx: Context, config: RebridgeConfig, log: RebridgeLog): AdmitRebridge;
