/**
 * admin 切片公共面（P2 ①②）：管理列表 + 管理重置。
 * 2026-09-24 新建；Steiger 的公共 API 规则只认本 barrel，新增导出必须在此登记。
 * 冻结接口：`makeAdminRoutes(deps)`（index.ts 按此接线）。
 */
export { handleResetPassword, handleUsers, makeAdminRoutes } from "./api/endpoints.js";
export type { AdminDeps, AdminRoutes, ResetInput } from "./model/deps.js";
export { projectUsers } from "./model/users-list.js";
export type { AdminUserView } from "./model/users-list.js";
export { auditDenied, auditSuccess, RESET_DENIED_EVENT, RESET_EVENT } from "./model/audit.js";
export type {
  AdminAuditContext,
  AdminAuditEvent,
  AdminAuditLogger,
  AdminDenyReason,
} from "./model/audit.js";
