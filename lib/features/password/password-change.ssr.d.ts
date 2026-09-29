import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionStore } from "../../session/index.js";
/**
 * 改密端点（`/auth/password`）的 SSR 页面与响应整形（P2 §1/§3/§6）。
 *
 * 与 `password-change.ts` 分文件的原因：后者已经贴着 250 行门禁，P2 的
 * 「页面渲染 + nav 协商 + 响应写出」全部落在这里，`password-change.ts` 只留
 * POST 处理顺序与 method 分发。`sendJson` / `sendUnavailable` / `respondFormError`
 * 是 P1 的三个叶子写出函数，为腾出门禁行数一并下移（纯搬家，行为不变）。
 * 本模块不持有任何业务写路径。
 *
 * 自足性硬约束（受限会话进不了宿主 UI，页面白屏 = 生产锁死）：
 * 零外链（CSS 全内联、无字体/无 url()）、无 `<script>`、不回填任何口令 value。
 * 页面文案与 Location 全部是服务端常量，绝不拼接请求文本（无反射面/无开放重定向面）。
 */
/** 改密页与登录页的固定路径：Location 只用这两个常量。 */
export declare const PASSWORD_CHANGE_PATH = "/auth/password";
export declare const LOGIN_PATH = "/auth/login";
/** GET /auth/password 的 deps 子集：只读会话，不参与任何写路径。 */
export interface PasswordChangePageDeps {
    sessions: () => SessionStore | undefined;
    cookieName: string;
}
/** 改密响应写出需要的 deps 子集（清 cookie 用）。 */
export interface ChangeResponseDeps {
    cookieName: string;
    cookieSecure: boolean;
}
/**
 * 自足改密页 HTML：唯一表单（POST /auth/password），隐藏字段 `nav=1` 让成功走 302
 * 而非 JSON；`current/password/confirm/code` 四字段**无一回填 value**（hidden 的
 * nav 是契约要求，属唯一例外）。无 `<script>`，页面不依赖任何 JS 也能提交。
 */
export declare function passwordChangePageHtml(notice: string | undefined): string;
/**
 * `GET /auth/password`：有会话（full 或 restricted）→ 200 自足表单；
 * 未认证 → `302 /auth/login?next=/auth/password`（唯一语义：不渲染登录页、不 401，
 * 否则受限闭环会断）。token 模式不注册本路由（注册在 password 模式的 endpoints 里）。
 */
export declare function handlePasswordChangePage(deps: PasswordChangePageDeps, req: IncomingMessage, res: ServerResponse): void;
/**
 * 改密成功响应整形：`nav=1`（SSR 无 JS 表单）→ `302 /auth/login?notice=password-changed`，
 * 否则保持 P1 的 `200 {"ok":true}`（面板 fetch 的判定绝不依赖 `Accept` 子串）。
 * set-cookie 必须早于 writeHead。
 */
export declare function respondChanged(deps: ChangeResponseDeps, res: ServerResponse, navigation: boolean): void;
/** JSON 写出：no-store 必须早于 writeHead（headers sent 之后 setHeader 会抛）。 */
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
/** 503 统一写出（users 文件读/写失败语义）。 */
export declare function sendUnavailable(res: ServerResponse): void;
/** 415/413 响应（M19 复刻：413 先写 `connection: close`，不调 req.destroy）；无 status 的异常向上抛。 */
export declare function respondFormError(res: ServerResponse, error: unknown): void;
//# sourceMappingURL=password-change.ssr.d.ts.map