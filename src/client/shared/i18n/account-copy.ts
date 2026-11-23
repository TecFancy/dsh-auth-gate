/**
 * `auth` 词典的 account 分片：键名集中常量 + zh/en 两套文案。
 *
 * `index.tsx` 把两套词典注册进 `auth` 命名域（与 logout 同一 ns），
 * `account-section.tsx` 只通过槽位注入的 `t` 读取本文件的键，不自己拼字符串。
 * 策略文案里的长度边界来自跨半边契约（`PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`，D31）：
 * 不在这里写字面量，口径随契约一起变（C12）。
 */
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type PasswordRule } from "../api/index.ts";
import { PASSKEY_DICT_EN, PASSKEY_DICT_ZH } from "./passkey-copy.ts";

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
  /** 401 `unauthorized`：会话失效（不是当前口令错），要带「重新登录」入口（C1）。 */
  expired: "account.expired",
  /** 403 `bad_origin`：跨源提交被拒，与「口令错」无关（C1）。 */
  badOrigin: "account.badOrigin",
  /** 渲染期异常的错误边界兜底文案（C7）。 */
  loadFailed: "account.loadFailed",
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
  // 重设计（2026-11-16）：账号上下文行 + 状态化动态码提示 + 重试 + 实例管理区。
  contextLocal: "account.context.local",
  roleAdmin: "account.role.admin",
  roleUser: "account.role.user",
  totpOn: "account.totp.on",
  totpOff: "account.totp.off",
  codeHintOn: "account.codeHintOn",
  codeHintOff: "account.codeHintOff",
  retry: "account.retry",
  adminAreaTitle: "account.adminArea.title",
  adminAreaIntro: "account.adminArea.intro",
  /**
   * passkey-only 提示（`passkey: "required"`，issue #133）：改密表单仍然可用，但改完不能
   * 用它登录 - 不说明的话，用户会以为改完密码就能回到登录页。
   */
  passkeyOnlyNotice: "account.passkeyOnlyNotice",
  // 页脚（2026-11-23）：版本行 + 星标入口。版本号来自 host 的 /auth/status，不是前端常量。
  footerVersion: "account.footer.version",
  starCta: "account.footer.star",
  starHint: "account.footer.starHint",
} as const;

/** 契约 §2 策略规则名 → 词典键（`satisfies` 保证与契约的 `PasswordRule` 一一对应）。 */
const RULE_KEYS: Record<string, string> = {
  minLength: ACCOUNT_KEYS.ruleMinLength,
  maxLength: ACCOUNT_KEYS.ruleMaxLength,
  uppercase: ACCOUNT_KEYS.ruleUppercase,
  lowercase: ACCOUNT_KEYS.ruleLowercase,
  digit: ACCOUNT_KEYS.ruleDigit,
  special: ACCOUNT_KEYS.ruleSpecial,
  sameAsOld: ACCOUNT_KEYS.ruleSameAsOld,
} satisfies Record<PasswordRule, string>;

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
  [ACCOUNT_KEYS.passkeyOnlyNotice]:
    "本实例要求使用通行密钥登录。密码仍可用于在这里修改凭据，但不能用来登录。",
  [ACCOUNT_KEYS.footerVersion]: "dsh-auth-gate v{version}",
  [ACCOUNT_KEYS.starCta]: "给个星星鼓励一下 ★",
  [ACCOUNT_KEYS.starHint]: "Star 是别人判断这个插件还在维护的唯一依据。谢谢！",
  [ACCOUNT_KEYS.loading]: "正在确认登录状态...",
  [ACCOUNT_KEYS.loginRequired]: "请先登录后再修改密码。",
  [ACCOUNT_KEYS.current]: "当前密码",
  [ACCOUNT_KEYS.password]: "新密码",
  [ACCOUNT_KEYS.confirm]: "确认新密码",
  [ACCOUNT_KEYS.code]: "动态验证码",
  [ACCOUNT_KEYS.codeHint]: "已开启两步验证时填写 6 位动态码，否则留空。",
  [ACCOUNT_KEYS.policyHint]: `新密码至少 ${PASSWORD_MIN_LENGTH} 个字符，且包含大写字母、小写字母、数字和特殊字符，不能与当前密码相同。`,
  [ACCOUNT_KEYS.submit]: "修改密码",
  [ACCOUNT_KEYS.submitting]: "提交中...",
  [ACCOUNT_KEYS.success]: "密码已改，请重新登录。当前设备也已登出。",
  [ACCOUNT_KEYS.relogin]: "重新登录",
  [ACCOUNT_KEYS.currentRequired]: "请输入当前密码。",
  [ACCOUNT_KEYS.passwordRequired]: "请输入新密码。",
  [ACCOUNT_KEYS.mismatch]: "两次输入的新密码不一致。",
  [ACCOUNT_KEYS.invalidCredentials]: "当前密码不正确。",
  [ACCOUNT_KEYS.invalidTotp]: "动态验证码不正确，或该验证码已被使用，请等待下一枚验证码后重试。",
  [ACCOUNT_KEYS.expired]: "登录状态已失效，请重新登录后重试。",
  [ACCOUNT_KEYS.badOrigin]: "请求来源未被允许，请回到本实例的页面重试。",
  [ACCOUNT_KEYS.loadFailed]: "账号安全设置加载失败，请刷新页面后重试。",
  [ACCOUNT_KEYS.policyIntro]: "新密码不符合以下要求：",
  [ACCOUNT_KEYS.locked]: "尝试次数过多，请在 {seconds} 秒后重试。",
  [ACCOUNT_KEYS.lockedPlain]: "尝试次数过多，请稍后重试。",
  [ACCOUNT_KEYS.unavailable]: "服务暂时不可用，请稍后重试。",
  [ACCOUNT_KEYS.generic]: "修改失败，请稍后重试。",
  [ACCOUNT_KEYS.ruleMinLength]: `至少 ${PASSWORD_MIN_LENGTH} 个字符`,
  [ACCOUNT_KEYS.ruleMaxLength]: `不超过 ${PASSWORD_MAX_LENGTH} 个字符`,
  [ACCOUNT_KEYS.ruleUppercase]: "包含大写字母",
  [ACCOUNT_KEYS.ruleLowercase]: "包含小写字母",
  [ACCOUNT_KEYS.ruleDigit]: "包含数字",
  [ACCOUNT_KEYS.ruleSpecial]: "包含特殊字符（非字母数字）",
  [ACCOUNT_KEYS.ruleSameAsOld]: "不能与当前密码相同",
  [ACCOUNT_KEYS.contextLocal]: "本地账号",
  [ACCOUNT_KEYS.roleAdmin]: "管理员",
  [ACCOUNT_KEYS.roleUser]: "普通用户",
  [ACCOUNT_KEYS.totpOn]: "两步验证已开启",
  [ACCOUNT_KEYS.totpOff]: "两步验证未开启",
  [ACCOUNT_KEYS.codeHintOn]: "你的账号已开启两步验证，请输入 6 位动态码。",
  [ACCOUNT_KEYS.codeHintOff]: "当前未开启两步验证，此栏可留空。",
  [ACCOUNT_KEYS.retry]: "重试",
  [ACCOUNT_KEYS.adminAreaTitle]: "实例管理",
  [ACCOUNT_KEYS.adminAreaIntro]: "管理其他用户和本实例的登录方式。",
  // passkey 分片（`account.passkey.*`）：与 account 键同命名域，注册时一并进 `auth` 词典。
  ...PASSKEY_DICT_ZH,
};

/** 英文词典。 */
export const ACCOUNT_DICT_EN: Record<string, string> = {
  [ACCOUNT_KEYS.nav]: "Account security",
  [ACCOUNT_KEYS.title]: "Change password",
  [ACCOUNT_KEYS.intro]:
    "After the change, this device is signed out too. Sign in again with your new password.",
  [ACCOUNT_KEYS.scope]:
    "These are this instance's local sign-in credentials, not your DeepSeek account.",
  [ACCOUNT_KEYS.passkeyOnlyNotice]:
    "This instance requires a passkey to sign in. Your password still works for changing credentials here, but it cannot be used to sign in.",
  [ACCOUNT_KEYS.footerVersion]: "dsh-auth-gate v{version}",
  [ACCOUNT_KEYS.starCta]: "Give it a star ★",
  [ACCOUNT_KEYS.starHint]:
    "A star is how the next person knows this plugin is still maintained. Thank you!",
  [ACCOUNT_KEYS.loading]: "Checking your session...",
  [ACCOUNT_KEYS.loginRequired]: "Sign in first to change your password.",
  [ACCOUNT_KEYS.current]: "Current password",
  [ACCOUNT_KEYS.password]: "New password",
  [ACCOUNT_KEYS.confirm]: "Confirm new password",
  [ACCOUNT_KEYS.code]: "Verification code",
  [ACCOUNT_KEYS.codeHint]:
    "Enter the 6-digit code when two-factor authentication is on, otherwise leave it empty.",
  [ACCOUNT_KEYS.policyHint]: `At least ${PASSWORD_MIN_LENGTH} characters with an uppercase letter, a lowercase letter, a digit and a special character; it must differ from the current password.`,
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
  [ACCOUNT_KEYS.expired]: "Your session has expired. Sign in again and retry.",
  [ACCOUNT_KEYS.badOrigin]: "This request came from an unallowed origin. Retry from this page.",
  [ACCOUNT_KEYS.loadFailed]: "Could not load account security settings. Refresh the page to retry.",
  [ACCOUNT_KEYS.policyIntro]: "The new password does not meet these requirements:",
  [ACCOUNT_KEYS.locked]: "Too many attempts. Try again in {seconds} seconds.",
  [ACCOUNT_KEYS.lockedPlain]: "Too many attempts. Try again later.",
  [ACCOUNT_KEYS.unavailable]: "The service is temporarily unavailable. Please try again later.",
  [ACCOUNT_KEYS.generic]: "Could not change the password. Please try again later.",
  [ACCOUNT_KEYS.ruleMinLength]: `at least ${PASSWORD_MIN_LENGTH} characters`,
  [ACCOUNT_KEYS.ruleMaxLength]: `at most ${PASSWORD_MAX_LENGTH} characters`,
  [ACCOUNT_KEYS.ruleUppercase]: "an uppercase letter",
  [ACCOUNT_KEYS.ruleLowercase]: "a lowercase letter",
  [ACCOUNT_KEYS.ruleDigit]: "a digit",
  [ACCOUNT_KEYS.ruleSpecial]: "a special character (not a letter or digit)",
  [ACCOUNT_KEYS.ruleSameAsOld]: "different from the current password",
  [ACCOUNT_KEYS.contextLocal]: "Local account",
  [ACCOUNT_KEYS.roleAdmin]: "Admin",
  [ACCOUNT_KEYS.roleUser]: "User",
  [ACCOUNT_KEYS.totpOn]: "Two-factor on",
  [ACCOUNT_KEYS.totpOff]: "Two-factor off",
  [ACCOUNT_KEYS.codeHintOn]: "Two-factor is on for your account. Enter the 6-digit code.",
  [ACCOUNT_KEYS.codeHintOff]: "Two-factor is off. You can leave this field empty.",
  [ACCOUNT_KEYS.retry]: "Retry",
  [ACCOUNT_KEYS.adminAreaTitle]: "Instance management",
  [ACCOUNT_KEYS.adminAreaIntro]: "Manage other users and sign-in for this instance.",
  // passkey 分片（`account.passkey.*`）：与 account 键同命名域，注册时一并进 `auth` 词典。
  ...PASSKEY_DICT_EN,
};
