import type { ServerResponse } from "node:http";
import type { GateDeny, GuardKind, GuardRequest } from "./gate.js";
/**
 * 浏览器导航判定（P2 §3）：只认 `Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest: document`。
 * **禁止**用 `Accept` 子串匹配（面板 fetch 的 Accept 很杂，会假绿）；两个头都缺 →
 * false（fail-closed：按 API 处理，401 而不是放行）。
 */
export declare function isNavigationRequest(req: GuardRequest): boolean;
/**
 * Location 消毒（§6）：只允许站内相对路径（`/` 开头、非 `//`、无反斜杠、无控制符）。
 * 判定与登录 `next` 共用 `shared` 的 `isSafeRelativeTarget`：同一条 302 出口纪律，
 * 控制符会让浏览器把 `"/\t/evil.com"` 解析成协议相对的站外地址（见该文件注释）。
 */
export declare function isSafeLocation(location: string): boolean;
/**
 * 免守卫的公开只读静态路径（精确匹配）。浏览器抓取 Web App Manifest 时按规范
 * 不带凭证（Chromium `manifest_fetcher.cc`：只有 link 带 `crossorigin="use-credentials"`
 * 才是 `kInclude`，否则 `kOmit`），cookie/Bearer 门永远认不出这次请求，登录用户
 * 也会恒 401。manifest 只含应用名/图标/显示模式等公开元数据，不含工作区信息，
 * 故列入白名单（语义与 `/auth` 同一类：不认证也必须可达）。
 */
export declare const PUBLIC_STATIC_PATHS: readonly string[];
/**
 * 是否命中公开只读静态路径。`kind === "upgrade"` 一律不算：这些路径只有 HTTP
 * GET 语义，放行握手只会白扩攻击面（升级请求仍走完整认证）。
 */
export declare function isPublicStaticPath(kind: GuardKind, pathname: string): boolean;
/** 认证本地代理（`dsh-auth-proxy --mark-proxy`）附加的请求标记头。 */
export declare const PROXY_MARKER_HEADER = "x-dsh-proxy";
/** 是否命中"代理标记 + 禁行方法"：`/api/<method>` 路径上带 `X-Dsh-Proxy: 1`。 */
export declare function isProxyDeniedRequest(req: GuardRequest, pathname: string): boolean;
/**
 * 拒绝响应的传输无关模型：状态、头、正文。handler（node:http）与 resource（Fetch
 * `Response`）两种入口共用同一份拒绝语义，区别只在最后写回的方式。
 */
export interface GuardReply {
    status: number;
    headers: Record<string, string>;
    body: string | null;
}
/** 400：resource 路由拿到无法解析的 URL 时的兜底，不调用门也不调用原 resource。 */
export declare function badRequestReply(): GuardReply;
/** 403：代理标记命中禁行方法。与 dsh /api 围栏同形（forbidden），禁缓存。 */
export declare function forbiddenReply(): GuardReply;
/**
 * 计算一个拒绝决策的响应模型（P2；`decision` 缺省 = 字符串 `"deny"`）：
 * - `{deny:{redirect}}` → 302 gate 给出的目标（消毒失败则退回 LOGIN_PATH）；
 * - `{deny:{status}}` → 该 401/403；
 * - `{deny:{upgrade:true}}` → 401 兜底（正常不会落到 HTTP 面）；
 * - `"deny"`（旧门）→ 浏览器导航 302 登录页 + `next`，其余 401。
 * 一律 `cache-control: no-store`；两条 302 另加 `referrer-policy: no-referrer`：被拒的请求
 * URL 可能自带 dsh 的 launch token（`/?token=`），不加这条，浏览器跟随时会把带 token 的
 * 完整 URL 作为 Referer 送进登录页请求（进而进访问日志），绕开 `token=` 脱敏。
 */
export declare function denyReply(req: GuardRequest, decision?: GateDeny): GuardReply;
/** 把拒绝模型写进 node:http 响应。`body === null`（302）时只结束响应。 */
export declare function writeGuardReply(res: ServerResponse, reply: GuardReply): void;
/** 把拒绝模型转成 Fetch `Response`，供 resource 路由的守卫写回。 */
export declare function guardReplyToResponse(reply: GuardReply): Response;
//# sourceMappingURL=http.d.ts.map