/**
 * passkey 管理面板的 client 侧类型与纯逻辑：表单值、本地校验、失败映射。
 *
 * 线上形状（列表行、请求体、响应体、错误体）在跨半边契约 `src/protocol/`（D31），经
 * `shared/api` 进来；这里只剩表单状态与解析后的结果，它们不上线，host 不认识。
 */
import { isRecord, type PasskeyAdminErrorBody, type Unchecked } from "../../../shared/api/index.ts";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";

/** 添加表单字段（`label` / 当前口令 / 可选 TOTP 码）。 */
export type PasskeyField = "label" | "password" | "code";

export type PasskeyFormValues = Record<PasskeyField, string>;

/** 表单初值：提交成功后清回这一份。 */
export const EMPTY_PASSKEY_FORM: PasskeyFormValues = { label: "", password: "", code: "" };

/**
 * 再认证值（删除专用）：只有口令与动态码，**没有 label**。
 *
 * 与 `PasskeyFormValues` 分开是重设计的核心修正之一：原来删除读的是添加表单的
 * `values`，用户要删最后一把钥匙时得先在「添加通行密钥」里输密码（评审 F6）。
 * 类型上分开以后，删除路径拿不到 label，也就不可能误用添加表单的状态。
 */
export type PasskeyReauthValues = Pick<PasskeyFormValues, "password" | "code">;

/** 再认证初值。 */
export const EMPTY_PASSKEY_REAUTH: PasskeyReauthValues = { password: "", code: "" };

/** 名称长度上限（与 host 侧 `label` ≤ 64 字符的校验一致）。 */
export const PASSKEY_LABEL_MAX = 64;

/** 状态播报位 id：aria-live 落点，也是错误字段 `aria-describedby` 与焦点兜底的落点。 */
export const PASSKEY_STATUS_ID = "dsh-auth-gate-passkey-status";

/** 添加表单的字段 id（label htmlFor / aria 关联 / 失败聚焦共用）。 */
export function passkeyFieldId(field: PasskeyField): string {
  return `dsh-auth-gate-passkey-${field}`;
}

/** 删除确认区的字段 id（与添加表单分开，避免同 id 冲突）。 */
export function passkeyReauthFieldId(field: "password" | "code"): string {
  return `dsh-auth-gate-passkey-remove-${field}`;
}

/** 失败视图：已翻译消息 + 需标红的字段。 */
export interface PasskeyFailureView {
  message: string;
  fields: PasskeyField[];
}

/** 列表结果：401 登录态已死、403 受限会话、503/网络/解析失败、卸载中止。 */
export type PasskeyListResult =
  | { kind: "ok"; passkeys: PasskeySummaryView[] }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "failure" }
  | { kind: "aborted" };

/** 列表行（client 视图）：契约 `PasskeySummary` 的逐字段白名单解析结果。 */
export interface PasskeySummaryView {
  idPrefix: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  backupEligible: boolean;
  backupState: boolean;
  transports: string[];
}

/** 添加/删除结果：成功 / 映射出的失败 / 已中止。 */
export type PasskeyMutationResult =
  { kind: "ok" } | { kind: "failure"; failure: PasskeyFailureView } | { kind: "aborted" };

/** 设置读写结果（admin 开关）。 */
export type PasskeySettingsResult =
  | { kind: "ok"; conditionalUiEnabled: boolean }
  | { kind: "forbidden" }
  | { kind: "failure" }
  | { kind: "aborted" };

/**
 * 本地校验闭表：label → password（code 可选，不校验）。
 * `label` 用 `trim()` 判空与长度（名称两端空白无意义），口令字段不 trim。
 */
export function validatePasskeyForm(
  values: PasskeyFormValues,
  t: AccountTranslate,
): PasskeyFailureView | null {
  const label = values.label.trim();
  if (label === "") return { message: t(PASSKEY_KEYS.labelRequired), fields: ["label"] };
  if (label.length > PASSKEY_LABEL_MAX) {
    return { message: t(PASSKEY_KEYS.labelTooLong), fields: ["label"] };
  }
  if (values.password === "") {
    return { message: t(PASSKEY_KEYS.passwordRequired), fields: ["password"] };
  }
  return null;
}

/**
 * 删除前的本地校验：只要求当前口令。
 *
 * 动态码不在这里判：服务端只在「删最后一把」或 `all=1` 时才强制再认证，普通单删会
 * 忽略它。客户端统一要求口令（与 UI 文案承诺一致），码留空即不发。
 */
export function validatePasskeyReauth(
  values: PasskeyReauthValues,
  t: AccountTranslate,
): PasskeyFailureView | null {
  if (values.password === "") {
    return { message: t(PASSKEY_KEYS.passwordRequired), fields: ["password"] };
  }
  return null;
}

/** 错误码比较：码的字面量受契约约束，写错码编译不过；值本身仍是未校验的 `unknown`。 */
function isError(value: unknown, code: PasskeyAdminErrorBody["error"]): boolean {
  return value === code;
}

/**
 * 状态码矩阵 → 文案键（与 host 的 `PasskeyAdminErrorBody` 对齐）：
 * 400 bad_request、401 unauthorized、403 forbidden、404 not_found、429 locked(+retryAfter)、
 * 503 unavailable，其余一律 generic。`reason` 只用于区分「最后一枚凭据」这类策略拒绝。
 */
export function describePasskeyFailure(
  status: number,
  body: unknown,
  t: AccountTranslate,
): PasskeyFailureView {
  const record: Unchecked<PasskeyAdminErrorBody> = isRecord<PasskeyAdminErrorBody>(body)
    ? body
    : {};
  const error = record.error;
  if (status === 400) {
    return { message: t(PASSKEY_KEYS.badRequest), fields: [] };
  }
  if (status === 401) {
    if (isError(error, "unauthorized")) {
      return { message: t(PASSKEY_KEYS.unauthorized), fields: [] };
    }
    if (isError(error, "invalid_totp")) {
      return { message: t(PASSKEY_KEYS.invalidTotp), fields: ["code"] };
    }
    return { message: t(PASSKEY_KEYS.invalidCredentials), fields: ["password"] };
  }
  if (status === 403) return { message: t(PASSKEY_KEYS.forbidden), fields: [] };
  if (status === 404) return { message: t(PASSKEY_KEYS.notFound), fields: [] };
  if (status === 429) {
    const retryAfter = record.retryAfter;
    return typeof retryAfter === "number"
      ? { message: t(PASSKEY_KEYS.locked, { seconds: retryAfter }), fields: [] }
      : { message: t(PASSKEY_KEYS.lockedPlain), fields: [] };
  }
  if (status === 503) return { message: t(PASSKEY_KEYS.unavailable), fields: [] };
  return { message: t(PASSKEY_KEYS.generic), fields: [] };
}

/** 401 且错误码是 `invalid_totp` 时把焦点指向验证码框（口令正确、码错）。 */
export function isInvalidTotp(status: number, body: unknown): boolean {
  if (!isRecord<PasskeyAdminErrorBody>(body)) return false;
  return status === 401 && isError(body.error, "invalid_totp");
}
