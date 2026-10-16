/**
 * host 半边进入跨半边契约（`src/protocol/`，D31）的唯一入口。
 * host 的任何文件都经这里拿 `/auth/*` 路径，不直接引 `src/protocol/`，也不写路径字面量。
 */
export {
  AUTH_PATH_PREFIX,
  isAuthPath,
  LOGIN_PATH,
  loginPath,
  LOGOUT_PATH,
  PASSWORD_CHANGED_NOTICE,
  PASSWORD_PATH,
  STATUS_PATH,
  USERS_PASSWORD_PATH,
  USERS_PATH,
} from "../../../protocol/index.js";
