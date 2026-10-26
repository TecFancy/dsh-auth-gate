/**
 * 跨半边契约（D31）：`/auth/*` 路由路径、登录页查询键与端点载荷形状，host 与 client 两个半边的
 * 唯一来源。载荷类型在同目录的 `payloads.ts`，经本文件再导出（两个桥只认本文件）。
 *
 * 这里只放纯常量、纯函数与纯类型，不 import 自身以外的任何东西（`slice:check` 强制），所以它能
 * 同时进 Node 的 host 构建与浏览器的 client bundle，而不会把任何一侧的依赖带给另一侧。两个半边
 * 各经一个桥进来：
 * host 走 `src/host/shared/protocol/index.ts`，client 走 `src/client/shared/api/protocol.ts`。
 *
 * 改这里的值就是改对外契约（书签、反代规则、dsh 前端的跳转都认这些路径）：先改
 * `index.test.ts` 里钉住的值，再改这里。
 */
export type { AdminResetErrorBody, AdminResetRequest, AdminResetResponse, AdminUserRow, LockedErrorBody, PasswordChangeErrorBody, PasswordChangeRequest, PasswordChangeResponse, PasswordRule, PolicyErrorBody, SessionKind, StatusResponse, Unchecked, UserRole, UsersErrorBody, UsersResponse, } from "./payloads.js";
/** 本插件全部端点的前缀；`prefix` 兜底路由挂在这里，gate 白名单也按它放行。 */
export declare const AUTH_PATH_PREFIX = "/auth";
/** 登录页（GET 渲染、POST 提交）。 */
export declare const LOGIN_PATH = "/auth/login";
/** 登出（POST-only，`next` 只从 query 取）。 */
export declare const LOGOUT_PATH = "/auth/logout";
/** 会话探针（只认 cookie）。 */
export declare const STATUS_PATH = "/auth/status";
/** 自助改密（GET SSR 页，POST 提交）；也是受限会话被拒时的导航目标。 */
export declare const PASSWORD_PATH = "/auth/password";
/** 管理面：用户列表。 */
export declare const USERS_PATH = "/auth/users";
/** 管理面：管理员重置他人口令。 */
export declare const USERS_PASSWORD_PATH = "/auth/users/password";
/** 首次引导：校验 dsh launch token 并签发一次性的 bootstrap 会话（GET）。 */
export declare const BOOTSTRAP_PATH = "/auth/bootstrap";
/** 首次配置向导页（GET 渲染、POST 提交）；也是 bootstrap 会话被拒时的导航目标。 */
export declare const SETUP_PATH = "/auth/setup";
/** 向导完成后回首页：只认会话 cookie，302 到 dsh 的 `/?token=`。 */
export declare const CONTINUE_PATH = "/auth/continue";
/**
 * bootstrap 会话的 `kind` 值：只在首次引导通道签发，TTL 有上限，只能访问本插件的
 * `/auth/*`。向导完成后被整体吊销，不是第二种长期登录方式。
 */
export declare const BOOTSTRAP_SESSION_KIND = "bootstrap";
/** 登录页 `notice` 白名单键：改密成功后被登出。 */
export declare const PASSWORD_CHANGED_NOTICE = "password-changed";
/** 改密成功后 client 把当前设备送去的登录页（回首页，并带上被登出的原因键）。 */
export declare const PASSWORD_CHANGED_LOGIN_URL = "/auth/login?next=%2F&notice=password-changed";
/** 设置页「退出登录」按钮的提交目标（登出后回首页）。 */
export declare const LOGOUT_URL = "/auth/logout?next=/";
/** `pathname` 是否落在本插件的 `/auth` 命名空间里（恰好是前缀本身，或在它下面）。 */
export declare function isAuthPath(pathname: string): boolean;
/** 带 `next`（与可选 `stage`）的登录页 URL。 */
export declare function loginPath(next: string, stage?: "password"): string;
//# sourceMappingURL=index.d.ts.map