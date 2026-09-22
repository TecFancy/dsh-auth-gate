/**
 * http 层公共面：认证 HTTP 端点公共件（核心机制层，与 gate/、session/ 并列）。
 * token 与 password 两个认证面共用；跨 slice import 只能走本 barrel。
 */
export { authCatchAll, handleLogout, handleStatus, methodNotAllowed, queryOf, } from "./endpoints.js";
export type { AuthHttpDeps } from "./endpoints.js";
//# sourceMappingURL=index.d.ts.map