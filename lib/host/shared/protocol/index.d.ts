/**
 * host 半边进入跨半边契约（`src/protocol/`，D31）的唯一入口。
 * host 的任何文件都经这里拿 `/auth/*` 路径与载荷类型，不直接引 `src/protocol/`，也不写路径字面量。
 * `shared` 是最低层，entities 与 features 都能直接引它，不需要 `@x`。
 */
export { AUTH_PATH_PREFIX, isAuthPath, LOGIN_PATH, loginPath, LOGOUT_PATH, PASSWORD_CHANGED_NOTICE, PASSWORD_PATH, STATUS_PATH, USERS_PASSWORD_PATH, USERS_PATH, } from "../../../protocol/index.js";
export type { AdminResetErrorBody, AdminResetRequest, AdminResetResponse, AdminUserRow, LockedErrorBody, PasswordChangeErrorBody, PasswordChangeRequest, PasswordChangeResponse, PasswordRule, PolicyErrorBody, SessionKind, StatusResponse, Unchecked, UserRole, UsersErrorBody, UsersResponse, } from "../../../protocol/index.js";
//# sourceMappingURL=index.d.ts.map