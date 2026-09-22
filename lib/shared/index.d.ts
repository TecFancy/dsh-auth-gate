/**
 * shared 层公共面：跨 slice import 的唯一入口。
 * 通用件：next 校验 / cookie 解析 / 请求体解析 / 登录页 HTML / 限速 / CLI 技能安装 / users.yaml 仓库。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记，防止公共面被意外撑大。
 */
export { validateNext } from "./auth-common.js";
export { parseCookieHeader } from "./cookie.js";
export { FORM_BODY_LIMIT, parseFormBody } from "./form-body.js";
export { resolvePublicHost } from "./host.js";
export { loginPageHtml, loginPath, passwordLoginPageHtml, totpChallengePageHtml, } from "./login-page.js";
export { LoginRateLimiter } from "./rate-limit.js";
export type { RateLimitCheck, RateLimitOptions } from "./rate-limit.js";
export { bundledSkillDir, installSkill, SKILL_NAME, userSkillDir } from "./skill-install.js";
export type { InstallSkillOptions, InstallSkillResult } from "./skill-install.js";
export { compareNames, defaultUsersFilePath, dshHomeDir, loadUsersFile, USERNAME_RE, UsersFileError, writeUsersFile, } from "./users-file.js";
export type { UserRecord, UsersLoadResult, UsersSnapshot } from "./users-file.js";
//# sourceMappingURL=index.d.ts.map