/**
 * totp 认证增强面（M4 两段式登录的第二段：TOTP 校验 + 防重放 + CLI）。
 * password 登录流通过 deps 注入本层实现（同层互禁，见 index.ts 装配）。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记。
 */
export {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCodeAt,
  verifyTotpCode,
} from "./totp.js";
export { TotpReplayGuard } from "./replay-guard.js";
export { handleUserTotp, totpUri } from "./cli.js";
export type { TotpCliIo } from "./cli.js";
