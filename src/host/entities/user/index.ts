/**
 * user entity public API: the `users.yaml` repository and the password policy.
 * Explicit export list: register new exports here.
 */
export {
  compareNames,
  defaultUsersFilePath,
  loadUsersFile,
  mutateUsersFile,
  USERNAME_RE,
  UsersFileError,
  writeUsersFile,
} from "./model/users-file.js";
export type { UserRecord, UserRole, UsersLoadResult, UsersSnapshot } from "./model/users-file.js";
export { MAX_PASSKEYS_PER_USER, validatePasskeyStore } from "./model/passkey-record.js";
export type { PasskeyRecord } from "./model/passkey-record.js";
export {
  checkPasswordPolicy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./model/password-policy.js";
export type {
  PasswordPolicyOptions,
  PasswordPolicyResult,
  PasswordRule,
} from "./model/password-policy.js";
export { PASSKEY_ALGORITHMS, PASSKEY_TRANSPORTS } from "./model/passkey-record.js";
