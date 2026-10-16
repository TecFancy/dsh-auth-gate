/**
 * client 半边进入跨半边契约（`src/protocol/`，D31）的唯一入口。
 * 那边只有纯常量、纯函数与纯类型，打进 bundle 的只是几个字符串（类型编译后消失）。
 */
export {
  LOGOUT_URL,
  PASSWORD_CHANGED_LOGIN_URL,
  PASSWORD_PATH,
  STATUS_PATH,
  USERS_PASSWORD_PATH,
  USERS_PATH,
} from "../../../protocol/index.ts";
export type {
  AdminResetErrorBody,
  AdminResetRequest,
  AdminResetResponse,
  AdminUserRow,
  LockedErrorBody,
  PasswordChangeErrorBody,
  PasswordChangeRequest,
  PasswordChangeResponse,
  PasswordRule,
  PolicyErrorBody,
  SessionKind,
  StatusResponse,
  Unchecked,
  UserRole,
  UsersErrorBody,
  UsersResponse,
} from "../../../protocol/index.ts";
