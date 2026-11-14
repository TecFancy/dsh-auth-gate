/**
 * passkey 管理面板的 client 侧类型与纯逻辑：表单值、本地校验、失败映射。
 *
 * 线上形状（列表行、请求体、响应体、错误体）在跨半边契约 `src/protocol/`（D31），经
 * `shared/api` 进来；这里只剩表单状态与解析后的结果，它们不上线，host 不认识。
 */
import type { PasskeyAdminErrorBody, Unchecked } from "../../../shared/api/index.ts";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";

/** 添加表单字段（`label` / 当前口令 / 可选 TOTP 码）。 */
export type PasskeyField = "label" | "password" | "code";

export type PasskeyFormValues = Record<PasskeyField, string>;

/** 表单初值：提交成功后清回这一份。 */
export const EMPTY_PASSKEY_FORM: PasskeyFormValues = { label: "", password: "", code: "" };

/** 名称长度上限（与 host 侧 `label` ≤ 64 字符的校验一致）。 */
export const PASSKEY_LABEL_MAX = 64;

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

/** 错误码比较：码的字面量受契约约束，写错码编译不过；值本身仍是未校验的 `unknown`。 */
function isError(value: unknown, code: PasskeyAdminErrorBody["error"]): boolean {
  return value === code;
}

/**
 * 再认证的 TOTP 失败码。契约的 `PasskeyAdminErrorBody["error"]` 联合里没有它（与口令改密
 * 端点同形，401 下用 `invalid_totp` 区分「码错」与「口令错」），所以这里按字面量比较，
 * 不扩契约类型（`src/protocol/` 不在本 PR 的写域）。
 */
const INVALID_TOTP = "invalid_totp";

function isRecord(value: unknown): value is Unchecked<PasskeyAdminErrorBody> {
  return typeof value === "object" && value !== null;
}

/** 读错误体字段：`Unchecked<T>` 的索引签名在 `noPropertyAccessFromIndexSignature` 下要方括号，
 * 但 ESLint 又要求点号；这里统一收口成一个取值函数，两处规则都不再打架。 */
function fieldOf(
  record: Unchecked<PasskeyAdminErrorBody>,
  name: keyof PasskeyAdminErrorBody,
): unknown {
  return record[name];
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
  const record = isRecord(body) ? body : {};
  const error = fieldOf(record, "error");
  if (status === 400) {
    return { message: t(PASSKEY_KEYS.badRequest), fields: [] };
  }
  if (status === 401) {
    if (isError(error, "unauthorized")) {
      return { message: t(PASSKEY_KEYS.unauthorized), fields: [] };
    }
    if (error === INVALID_TOTP) {
      return { message: t(PASSKEY_KEYS.invalidTotp), fields: ["code"] };
    }
    return { message: t(PASSKEY_KEYS.invalidCredentials), fields: ["password"] };
  }
  if (status === 403) return { message: t(PASSKEY_KEYS.forbidden), fields: [] };
  if (status === 404) return { message: t(PASSKEY_KEYS.notFound), fields: [] };
  if (status === 429) {
    const retryAfter = fieldOf(record, "retryAfter");
    return typeof retryAfter === "number"
      ? { message: t(PASSKEY_KEYS.locked, { seconds: retryAfter }), fields: [] }
      : { message: t(PASSKEY_KEYS.lockedPlain), fields: [] };
  }
  if (status === 503) return { message: t(PASSKEY_KEYS.unavailable), fields: [] };
  return { message: t(PASSKEY_KEYS.generic), fields: [] };
}

/** 401 且错误码是 `invalid_totp` 时把焦点指向验证码框（口令正确、码错）。 */
export function isInvalidTotp(status: number, body: unknown): boolean {
  return status === 401 && isRecord(body) && fieldOf(body, "error") === INVALID_TOTP;
}
