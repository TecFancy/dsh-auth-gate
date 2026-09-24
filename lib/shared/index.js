/**
 * shared 层公共面：跨 slice import 的唯一入口。
 * 通用件：next 校验 / cookie 解析 / 请求体解析 / 登录页 HTML / 限速 / CLI 技能安装 / users.yaml 仓库。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记，防止公共面被意外撑大。
 */
export { validateNext } from "./auth-common.js";
export { DEFAULT_TRUSTED_PROXIES, makeClientIpResolver, parseClientIpPolicy, resolveClientIp, } from "./client-ip.js";
export { parseCookieHeader } from "./cookie.js";
export { FORM_BODY_LIMIT, parseFormBody } from "./form-body.js";
export { resolvePublicHost } from "./host.js";
export { cidrContains, normalizeIp, parseCidr } from "./ip-address.js";
export { loginPageHtml, loginPath, passwordLoginPageHtml, totpChallengePageHtml, } from "./login-page.js";
export { checkPasswordPolicy, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, } from "./password-policy.js";
export { LoginRateLimiter } from "./rate-limit.js";
export { bundledSkillDir, installSkill, SKILL_NAME, userSkillDir } from "./skill-install.js";
export { compareNames, defaultUsersFilePath, dshHomeDir, loadUsersFile, mutateUsersFile, USERNAME_RE, UsersFileError, writeUsersFile, } from "./users-file.js";
//# sourceMappingURL=index.js.map