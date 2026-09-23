/**
 * `auth` 词典的 account 分片：键名集中常量 + zh/en 两套文案。
 *
 * `index.tsx` 把两套词典注册进 `auth` 命名域（与 logout 同一 ns），
 * `account-section.tsx` 只通过槽位注入的 `t` 读取本文件的键，不自己拼字符串。
 * 策略文案里的 14/256 字符镜像契约 §2（`PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`）：
 * client bundle 不 import 服务端 shared 模块，半边保持解耦。
 */

/** 槽位注入的标准 `t` seat（host locale translate 的形）。 */
export type AccountTranslate = (key: string, params?: Record<string, unknown>) => string;

/** 本面板用到的词典键（集中常量，避免散落字符串）。 */
export const ACCOUNT_KEYS = {
  nav: "account",
  title: "account.title",
  intro: "account.intro",
  /** 作用域说明（P1.1）：0.1.7 起宿主有官方「账户」段，这里要讲清"管的是本地登录凭据"。 */
  scope: "account.scope",
  loading: "account.loading",
  loginRequired: "account.loginRequired",
  current: "account.current",
  password: "account.password",
  confirm: "account.confirm",
  code: "account.code",
  codeHint: "account.codeHint",
  policyHint: "account.policyHint",
  submit: "account.submit",
  submitting: "account.submitting",
  success: "account.success",
  /**
   * 成功态按钮（P1.1 / D24）：不再是「关闭」：服务端此刻已吊销全部会话，关掉弹窗只会
   * 停在「死会话 SPA」上；改为直接去登录页。
   */
  relogin: "account.relogin",
  currentRequired: "account.currentRequired",
  passwordRequired: "account.passwordRequired",
  mismatch: "account.mismatch",
  invalidCredentials: "account.invalidCredentials",
  invalidTotp: "account.invalidTotp",
  policyIntro: "account.policyIntro",
  locked: "account.locked",
  lockedPlain: "account.lockedPlain",
  unavailable: "account.unavailable",
  generic: "account.generic",
  ruleMinLength: "account.rule.minLength",
  ruleMaxLength: "account.rule.maxLength",
  ruleUppercase: "account.rule.uppercase",
  ruleLowercase: "account.rule.lowercase",
  ruleDigit: "account.rule.digit",
  ruleSpecial: "account.rule.special",
  ruleSameAsOld: "account.rule.sameAsOld",
} as const;

/** 契约 §2 策略规则名 → 词典键。 */
const RULE_KEYS: Record<string, string> = {
  minLength: ACCOUNT_KEYS.ruleMinLength,
  maxLength: ACCOUNT_KEYS.ruleMaxLength,
  uppercase: ACCOUNT_KEYS.ruleUppercase,
  lowercase: ACCOUNT_KEYS.ruleLowercase,
  digit: ACCOUNT_KEYS.ruleDigit,
  special: ACCOUNT_KEYS.ruleSpecial,
  sameAsOld: ACCOUNT_KEYS.ruleSameAsOld,
};

/** 规则名翻译；未知规则原样回显（不发明契约之外的文案）。 */
export function ruleText(rule: string, t: AccountTranslate): string {
  const key = RULE_KEYS[rule];
  return key === undefined ? rule : t(key);
}

/** host locale 的插值规则（`{name}`；缺参数时保留占位符不吞字）。 */
export function formatCopy(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** 用一套词典兜底成 translate（槽位未注入 `t` 时降级为英文，不显示键名）。 */
export function translateFrom(dict: Record<string, string>): AccountTranslate {
  return (key, params) => formatCopy(dict[key] ?? key, params);
}

/** 中文词典。 */
export const ACCOUNT_DICT_ZH: Record<string, string> = {
  [ACCOUNT_KEYS.nav]: "账号安全",
  [ACCOUNT_KEYS.title]: "修改密码",
  [ACCOUNT_KEYS.intro]: "改密成功后，当前设备也会被登出，需要用新密码重新登录。",
  [ACCOUNT_KEYS.scope]: "这里是本实例的本地登录凭据，与 DeepSeek 云账户无关。",
  [ACCOUNT_KEYS.loading]: "正在确认登录状态...",
  [ACCOUNT_KEYS.loginRequired]: "请先登录后再修改密码。",
  [ACCOUNT_KEYS.current]: "当前密码",
  [ACCOUNT_KEYS.password]: "新密码",
  [ACCOUNT_KEYS.confirm]: "确认新密码",
  [ACCOUNT_KEYS.code]: "动态验证码",
  [ACCOUNT_KEYS.codeHint]: "已开启两步验证时填写 6 位动态码，否则留空。",
  [ACCOUNT_KEYS.policyHint]:
    "新密码至少 14 个字符，且包含大写字母、小写字母、数字和特殊字符，不能与当前密码相同。",
  [ACCOUNT_KEYS.submit]: "修改密码",
  [ACCOUNT_KEYS.submitting]: "提交中...",
  [ACCOUNT_KEYS.success]: "密码已改，请重新登录。当前设备也已登出。",
  [ACCOUNT_KEYS.relogin]: "重新登录",
  [ACCOUNT_KEYS.currentRequired]: "请输入当前密码。",
  [ACCOUNT_KEYS.passwordRequired]: "请输入新密码。",
  [ACCOUNT_KEYS.mismatch]: "两次输入的新密码不一致。",
  [ACCOUNT_KEYS.invalidCredentials]: "当前密码不正确。",
  [ACCOUNT_KEYS.invalidTotp]: "动态验证码不正确，或该验证码已被使用，请等待下一枚验证码后重试。",
  [ACCOUNT_KEYS.policyIntro]: "新密码不符合以下要求：",
  [ACCOUNT_KEYS.locked]: "尝试次数过多，请在 {seconds} 秒后重试。",
  [ACCOUNT_KEYS.lockedPlain]: "尝试次数过多，请稍后重试。",
  [ACCOUNT_KEYS.unavailable]: "服务暂时不可用，请稍后重试。",
  [ACCOUNT_KEYS.generic]: "修改失败，请稍后重试。",
  [ACCOUNT_KEYS.ruleMinLength]: "至少 14 个字符",
  [ACCOUNT_KEYS.ruleMaxLength]: "不超过 256 个字符",
  [ACCOUNT_KEYS.ruleUppercase]: "包含大写字母",
  [ACCOUNT_KEYS.ruleLowercase]: "包含小写字母",
  [ACCOUNT_KEYS.ruleDigit]: "包含数字",
  [ACCOUNT_KEYS.ruleSpecial]: "包含特殊字符（非字母数字）",
  [ACCOUNT_KEYS.ruleSameAsOld]: "不能与当前密码相同",
};

/** 英文词典。 */
export const ACCOUNT_DICT_EN: Record<string, string> = {
  [ACCOUNT_KEYS.nav]: "Account security",
  [ACCOUNT_KEYS.title]: "Change password",
  [ACCOUNT_KEYS.intro]:
    "After the change, this device is signed out too. Sign in again with your new password.",
  [ACCOUNT_KEYS.scope]:
    "These are this instance's local sign-in credentials, not your DeepSeek account.",
  [ACCOUNT_KEYS.loading]: "Checking your session...",
  [ACCOUNT_KEYS.loginRequired]: "Sign in first to change your password.",
  [ACCOUNT_KEYS.current]: "Current password",
  [ACCOUNT_KEYS.password]: "New password",
  [ACCOUNT_KEYS.confirm]: "Confirm new password",
  [ACCOUNT_KEYS.code]: "Verification code",
  [ACCOUNT_KEYS.codeHint]:
    "Enter the 6-digit code when two-factor authentication is on, otherwise leave it empty.",
  [ACCOUNT_KEYS.policyHint]:
    "At least 14 characters with an uppercase letter, a lowercase letter, a digit and a special character; it must differ from the current password.",
  [ACCOUNT_KEYS.submit]: "Change password",
  [ACCOUNT_KEYS.submitting]: "Submitting...",
  [ACCOUNT_KEYS.success]:
    "Password changed. Please sign in again. This device has been signed out too.",
  [ACCOUNT_KEYS.relogin]: "Sign in again",
  [ACCOUNT_KEYS.currentRequired]: "Enter your current password.",
  [ACCOUNT_KEYS.passwordRequired]: "Enter a new password.",
  [ACCOUNT_KEYS.mismatch]: "The two new passwords do not match.",
  [ACCOUNT_KEYS.invalidCredentials]: "The current password is incorrect.",
  [ACCOUNT_KEYS.invalidTotp]:
    "The verification code is incorrect or already used; wait for the next code and try again.",
  [ACCOUNT_KEYS.policyIntro]: "The new password does not meet these requirements:",
  [ACCOUNT_KEYS.locked]: "Too many attempts. Try again in {seconds} seconds.",
  [ACCOUNT_KEYS.lockedPlain]: "Too many attempts. Try again later.",
  [ACCOUNT_KEYS.unavailable]: "The service is temporarily unavailable. Please try again later.",
  [ACCOUNT_KEYS.generic]: "Could not change the password. Please try again later.",
  [ACCOUNT_KEYS.ruleMinLength]: "at least 14 characters",
  [ACCOUNT_KEYS.ruleMaxLength]: "at most 256 characters",
  [ACCOUNT_KEYS.ruleUppercase]: "an uppercase letter",
  [ACCOUNT_KEYS.ruleLowercase]: "a lowercase letter",
  [ACCOUNT_KEYS.ruleDigit]: "a digit",
  [ACCOUNT_KEYS.ruleSpecial]: "a special character (not a letter or digit)",
  [ACCOUNT_KEYS.ruleSameAsOld]: "different from the current password",
};
