/**
 * http 层公共面：认证 HTTP 端点公共件（核心机制层，与 gate/、session/ 并列）。
 * token 与 password 两个认证面共用；跨 slice import 只能走本 barrel。
 * D29：纯 HTTP 件（`endpoints.ts`）与会话件（`session-endpoints.ts`）分文件，公共面不变。
 */
export { authCatchAll, methodNotAllowed, queryOf } from "./endpoints.js";
export { handleLogout, handleStatus } from "./session-endpoints.js";
export type { AuthHttpDeps } from "./session-endpoints.js";
//# sourceMappingURL=index.d.ts.map