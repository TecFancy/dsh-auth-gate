import { PASSWORD_MIN_LENGTH } from "../../../shared/api/index.ts";
import { formatCopy, type AccountTranslate } from "../../../shared/i18n/index.ts";

/**
 * 管理块（PR2）的 `auth` 词典分片：键名集中常量 + zh/en 两套文案。
 *
 * 与 account 分片同命名域（`index.tsx` 把两套词典合并注册），管理块只通过注入的 `t` 读键。
 * 键与文案对齐 CONTRACT-pr2 §4 全表 + §9/A4 的 2 个新增键（冻结键集 = 42）；
 * 策略规则名复用 `account-copy.ts` 的 `ruleText`，本文件不新造规则文案。
 */

/** 管理块 translate：与自助改密同形（宿主只注入一个 `t` seat）。 */
export type AdminTranslate = AccountTranslate;

/** 管理块词典键（集中常量，避免散落字符串）。 */
export const ADMIN_KEYS = {
  title: "admin.title",
  intro: "admin.intro",
  selfHint: "admin.selfHint",
  loading: "admin.loading",
  unavailable: "admin.unavailable",
  empty: "admin.empty",
  colUser: "admin.colUser",
  colRole: "admin.colRole",
  colState: "admin.colState",
  colTotp: "admin.colTotp",
  roleAdmin: "admin.roleAdmin",
  roleUser: "admin.roleUser",
  you: "admin.you",
  stateDisabled: "admin.stateDisabled",
  stateMustChange: "admin.stateMustChange",
  stateOk: "admin.stateOk",
  totpOn: "admin.totpOn",
  totpOff: "admin.totpOff",
  target: "admin.target",
  targetPlaceholder: "admin.targetPlaceholder",
  password: "admin.password",
  confirm: "admin.confirm",
  code: "admin.code",
  codeHint: "admin.codeHint",
  policyHint: "admin.policyHint",
  submit: "admin.submit",
  submitting: "admin.submitting",
  successRevoked: "admin.successRevoked",
  successKept: "admin.successKept",
  targetRequired: "admin.targetRequired",
  passwordRequired: "admin.passwordRequired",
  mismatch: "admin.mismatch",
  codeRequired: "admin.codeRequired",
  forbidden: "admin.forbidden",
  badTarget: "admin.badTarget",
  notFound: "admin.notFound",
  policyIntro: "admin.policyIntro",
  invalidTotp: "admin.invalidTotp",
  unauthorized: "admin.unauthorized",
  locked: "admin.locked",
  lockedPlain: "admin.lockedPlain",
  generic: "admin.generic",
  // 重设计（2026-11-16）：重置入口、动态目标字段、确认阶段、表格 caption。
  resetOpen: "admin.resetOpen",
  resetTitle: "admin.resetTitle",
  targetPassword: "admin.targetPassword",
  targetConfirm: "admin.targetConfirm",
  confirmTitle: "admin.confirmTitle",
  confirmWarning: "admin.confirmWarning",
  confirmSubmit: "admin.confirmSubmit",
  confirming: "admin.confirming",
  back: "admin.back",
  cancel: "admin.cancel",
  resetContext: "admin.resetContext",
  tableCaption: "admin.tableCaption",
  retry: "admin.retry",
} as const;

/** 中文词典（键序与 §4 表一致，A4 的 2 键插在语义位置）。 */
export const ADMIN_DICT_ZH: Record<string, string> = {
  [ADMIN_KEYS.title]: "用户管理",
  [ADMIN_KEYS.intro]: "重置后，该用户下次登录会被要求立即改密；会话吊销若失败会单独提示。",
  [ADMIN_KEYS.selfHint]:
    "修改自己的密码请用上方表单。忘记自己的口令走 CLI `dsh-auth user passwd`（管理面不允许重置自己）。",
  [ADMIN_KEYS.loading]: "正在加载用户列表...",
  [ADMIN_KEYS.unavailable]: "用户列表暂时不可用，请稍后重试。",
  [ADMIN_KEYS.empty]: "没有可重置的其他用户。",
  [ADMIN_KEYS.colUser]: "用户",
  [ADMIN_KEYS.colRole]: "角色",
  [ADMIN_KEYS.colState]: "状态",
  [ADMIN_KEYS.colTotp]: "两步验证",
  [ADMIN_KEYS.roleAdmin]: "管理员",
  [ADMIN_KEYS.roleUser]: "用户",
  [ADMIN_KEYS.you]: "本人",
  [ADMIN_KEYS.stateDisabled]: "已禁用",
  [ADMIN_KEYS.stateMustChange]: "需改密",
  [ADMIN_KEYS.stateOk]: "正常",
  [ADMIN_KEYS.totpOn]: "已开启",
  [ADMIN_KEYS.totpOff]: "未开启",
  [ADMIN_KEYS.target]: "目标用户",
  [ADMIN_KEYS.targetPlaceholder]: "请选择用户",
  [ADMIN_KEYS.password]: "新密码",
  [ADMIN_KEYS.confirm]: "确认新密码",
  [ADMIN_KEYS.code]: "动态验证码",
  [ADMIN_KEYS.codeHint]: "你已开启两步验证，重置他人密码需填写动态码。",
  [ADMIN_KEYS.policyHint]: `新密码至少 ${PASSWORD_MIN_LENGTH} 个字符，且含大写字母、小写字母、数字和特殊字符。`,
  [ADMIN_KEYS.submit]: "检查重置",
  [ADMIN_KEYS.submitting]: "提交中...",
  [ADMIN_KEYS.successRevoked]: "已重置，该用户的会话已全部吊销。",
  [ADMIN_KEYS.successKept]: "已重置，但该用户的现有会话仍然有效（吊销失败），请手动处理。",
  [ADMIN_KEYS.targetRequired]: "请选择目标用户。",
  [ADMIN_KEYS.passwordRequired]: "请输入新密码。",
  [ADMIN_KEYS.mismatch]: "两次输入的新密码不一致。",
  [ADMIN_KEYS.codeRequired]: "请输入动态验证码。",
  [ADMIN_KEYS.forbidden]: "没有权限执行此操作，或当前会话不允许。",
  [ADMIN_KEYS.badTarget]: "目标用户名不合法。",
  [ADMIN_KEYS.notFound]: "目标用户不存在。",
  [ADMIN_KEYS.policyIntro]: "新密码不符合以下要求：",
  [ADMIN_KEYS.invalidTotp]: "动态验证码不正确，或已被使用。",
  [ADMIN_KEYS.unauthorized]: "登录状态已失效，请重新登录。",
  [ADMIN_KEYS.locked]: "尝试次数过多，请在 {seconds} 秒后重试。",
  [ADMIN_KEYS.lockedPlain]: "尝试次数过多，请稍后重试。",
  [ADMIN_KEYS.generic]: "重置失败，请稍后重试。",
  [ADMIN_KEYS.resetOpen]: "重置他人密码",
  [ADMIN_KEYS.resetTitle]: "为其他用户设置新密码",
  [ADMIN_KEYS.targetPassword]: "{name} 的新密码",
  [ADMIN_KEYS.targetConfirm]: "确认 {name} 的新密码",
  [ADMIN_KEYS.confirmTitle]: "确认重置 {name} 的密码？",
  [ADMIN_KEYS.confirmWarning]:
    "旧密码会立即失效；系统会尝试吊销 {name} 的所有会话。此操作不可撤销。",
  [ADMIN_KEYS.confirmSubmit]: "确认重置 {name} 的密码",
  [ADMIN_KEYS.confirming]: "正在重置 {name}...",
  [ADMIN_KEYS.back]: "返回修改",
  [ADMIN_KEYS.cancel]: "取消并清空",
  [ADMIN_KEYS.resetContext]: "目标：{name}。不会修改你的账号 {actor}。",
  [ADMIN_KEYS.tableCaption]: "实例用户列表",
  [ADMIN_KEYS.retry]: "重试",
};

/** 英文词典（键序与中文一致）。 */
export const ADMIN_DICT_EN: Record<string, string> = {
  [ADMIN_KEYS.title]: "User management",
  [ADMIN_KEYS.intro]:
    "After a reset the user must change the password at the next sign-in; if revocation fails, that is reported separately.",
  [ADMIN_KEYS.selfHint]:
    "Use the form above to change your own password. If you forgot it, use the CLI `dsh-auth user passwd` (this panel cannot reset your own account).",
  [ADMIN_KEYS.loading]: "Loading users...",
  [ADMIN_KEYS.unavailable]: "The user list is temporarily unavailable. Please try again later.",
  [ADMIN_KEYS.empty]: "There are no other users to reset.",
  [ADMIN_KEYS.colUser]: "User",
  [ADMIN_KEYS.colRole]: "Role",
  [ADMIN_KEYS.colState]: "State",
  [ADMIN_KEYS.colTotp]: "Two-factor",
  [ADMIN_KEYS.roleAdmin]: "Admin",
  [ADMIN_KEYS.roleUser]: "User",
  [ADMIN_KEYS.you]: "You",
  [ADMIN_KEYS.stateDisabled]: "Disabled",
  [ADMIN_KEYS.stateMustChange]: "Must change",
  [ADMIN_KEYS.stateOk]: "Normal",
  [ADMIN_KEYS.totpOn]: "On",
  [ADMIN_KEYS.totpOff]: "Off",
  [ADMIN_KEYS.target]: "Target user",
  [ADMIN_KEYS.targetPlaceholder]: "Choose a user",
  [ADMIN_KEYS.password]: "New password",
  [ADMIN_KEYS.confirm]: "Confirm new password",
  [ADMIN_KEYS.code]: "Verification code",
  [ADMIN_KEYS.codeHint]:
    "Two-factor is on for your account, so resetting another user needs a code.",
  [ADMIN_KEYS.policyHint]: `At least ${PASSWORD_MIN_LENGTH} characters with an uppercase letter, a lowercase letter, a digit and a special character.`,
  [ADMIN_KEYS.submit]: "Review reset",
  [ADMIN_KEYS.submitting]: "Submitting...",
  [ADMIN_KEYS.successRevoked]: "Reset done. All of that user's sessions were revoked.",
  [ADMIN_KEYS.successKept]:
    "Reset done, but that user's existing sessions are still valid (revocation failed); handle them manually.",
  [ADMIN_KEYS.targetRequired]: "Choose a target user.",
  [ADMIN_KEYS.passwordRequired]: "Enter a new password.",
  [ADMIN_KEYS.mismatch]: "The two new passwords do not match.",
  [ADMIN_KEYS.codeRequired]: "Enter the verification code.",
  [ADMIN_KEYS.forbidden]: "You are not allowed to do this, or this session is not allowed to.",
  [ADMIN_KEYS.badTarget]: "The target user name is invalid.",
  [ADMIN_KEYS.notFound]: "The target user does not exist.",
  [ADMIN_KEYS.policyIntro]: "The new password does not meet these requirements:",
  [ADMIN_KEYS.invalidTotp]: "The verification code is incorrect or already used.",
  [ADMIN_KEYS.unauthorized]: "Your session has expired. Please sign in again.",
  [ADMIN_KEYS.locked]: "Too many attempts. Try again in {seconds} seconds.",
  [ADMIN_KEYS.lockedPlain]: "Too many attempts. Try again later.",
  [ADMIN_KEYS.generic]: "Could not reset the password. Please try again later.",
  [ADMIN_KEYS.resetOpen]: "Reset another user's password",
  [ADMIN_KEYS.resetTitle]: "Set a new password for another user",
  [ADMIN_KEYS.targetPassword]: "New password for {name}",
  [ADMIN_KEYS.targetConfirm]: "Confirm the new password for {name}",
  [ADMIN_KEYS.confirmTitle]: "Reset {name}'s password?",
  [ADMIN_KEYS.confirmWarning]:
    "The old password stops working immediately, and the system will try to revoke all of {name}'s sessions. This cannot be undone.",
  [ADMIN_KEYS.confirmSubmit]: "Confirm reset for {name}",
  [ADMIN_KEYS.confirming]: "Resetting {name}...",
  [ADMIN_KEYS.back]: "Back to edit",
  [ADMIN_KEYS.cancel]: "Cancel and clear",
  [ADMIN_KEYS.resetContext]: "Target: {name}. Your account, {actor}, is unchanged.",
  [ADMIN_KEYS.tableCaption]: "Instance users",
  [ADMIN_KEYS.retry]: "Retry",
};

/**
 * 用一套词典兜底成 translate：缺键先回落英文词典，两边都缺时回空串，
 * **绝不把键名当文案显示**（§4 表注）。
 */
export function translateAdminFrom(dict: Record<string, string>): AdminTranslate {
  return (key, params) => formatCopy(dict[key] ?? ADMIN_DICT_EN[key] ?? "", params);
}
