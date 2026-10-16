/**
 * 跨半边契约（D31）：`/auth/*` 路由路径与登录页查询键，host 与 client 两个半边的唯一来源。
 *
 * 这里只放纯常量与纯函数，不 import 任何东西（`slice:check` 强制），所以它能同时进 Node 的
 * host 构建与浏览器的 client bundle，而不会把任何一侧的依赖带给另一侧。两个半边各经一个桥进来：
 * host 走 `src/host/shared/protocol/index.ts`，client 走 `src/client/shared/api/protocol.ts`。
 *
 * 改这里的值就是改对外契约（书签、反代规则、dsh 前端的跳转都认这些路径）：先改
 * `index.test.ts` 里钉住的值，再改这里。
 */
/** 本插件全部端点的前缀；`prefix` 兜底路由挂在这里，gate 白名单也按它放行。 */
export const AUTH_PATH_PREFIX = "/auth";
/** 登录页（GET 渲染、POST 提交）。 */
export const LOGIN_PATH = "/auth/login";
/** 登出（POST-only，`next` 只从 query 取）。 */
export const LOGOUT_PATH = "/auth/logout";
/** 会话探针（只认 cookie）。 */
export const STATUS_PATH = "/auth/status";
/** 自助改密（GET SSR 页，POST 提交）；也是受限会话被拒时的导航目标。 */
export const PASSWORD_PATH = "/auth/password";
/** 管理面：用户列表。 */
export const USERS_PATH = "/auth/users";
/** 管理面：管理员重置他人口令。 */
export const USERS_PASSWORD_PATH = "/auth/users/password";
/** 登录页 `notice` 白名单键：改密成功后被登出。 */
export const PASSWORD_CHANGED_NOTICE = "password-changed";
/** 改密成功后 client 把当前设备送去的登录页（回首页，并带上被登出的原因键）。 */
export const PASSWORD_CHANGED_LOGIN_URL = `${LOGIN_PATH}?next=%2F&notice=${PASSWORD_CHANGED_NOTICE}`;
/** 设置页「退出登录」按钮的提交目标（登出后回首页）。 */
export const LOGOUT_URL = `${LOGOUT_PATH}?next=/`;
/** `pathname` 是否落在本插件的 `/auth` 命名空间里（恰好是前缀本身，或在它下面）。 */
export function isAuthPath(pathname) {
    return pathname === AUTH_PATH_PREFIX || pathname.startsWith(`${AUTH_PATH_PREFIX}/`);
}
/** 带 `next`（与可选 `stage`）的登录页 URL。 */
export function loginPath(next, stage) {
    const base = `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
    return stage === undefined ? base : `${base}&stage=${stage}`;
}
//# sourceMappingURL=index.js.map