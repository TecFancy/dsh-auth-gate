import {
  encodeForm,
  isRecord,
  PASSWORD_PATH,
  readJsonSafe,
  type PasswordChangeErrorBody,
  type PasswordChangeRequest,
  type Unchecked,
} from "../../../shared/api/index.ts";
import { ACCOUNT_KEYS, ruleText, type AccountTranslate } from "../../../shared/i18n/index.ts";

/** 自助改密端点（契约 §1：POST + application/x-www-form-urlencoded）。 */
const PASSWORD_TARGET = PASSWORD_PATH;

/** 四个字段：契约 §1 只收 current/password/code，confirm 只在客户端比对。 */
export type FieldName = "current" | "password" | "confirm" | "code";

export type FormValues = Record<FieldName, string>;

export const EMPTY_VALUES: FormValues = { current: "", password: "", confirm: "", code: "" };

/**
 * 失败视图：消息 + 逐条策略规则 + 需要标红的字段。
 *
 * `relogin` 表示「当前口令未必错，是会话没了」：客户端据此渲染「重新登录」入口，
 * 而不是把用户钉在口令框上反复试（C1）。
 */
export interface FailureView {
  message: string;
  rules: string[];
  fields: FieldName[];
  relogin?: boolean | undefined;
}

/** 错误码比较：码的字面量受契约约束，写错码编译不过；值本身仍是未校验的 `unknown`。 */
function isError(value: unknown, code: PasswordChangeErrorBody["error"]): boolean {
  return value === code;
}

/** 客户端校验：两次新密码一致只在这里判（契约 §1：不进请求体）。值不 trim。 */
export function validate(values: FormValues, t: AccountTranslate): FailureView | null {
  if (values.current === "") {
    return { message: t(ACCOUNT_KEYS.currentRequired), rules: [], fields: ["current"] };
  }
  if (values.password === "") {
    return { message: t(ACCOUNT_KEYS.passwordRequired), rules: [], fields: ["password"] };
  }
  if (values.password !== values.confirm) {
    return { message: t(ACCOUNT_KEYS.mismatch), rules: [], fields: ["password", "confirm"] };
  }
  return null;
}

/** 400 `policy`：`rules` 只收字符串，未知规则名原样回显（不发明契约之外的文案）。 */
function describePolicy(
  record: Unchecked<PasswordChangeErrorBody>,
  t: AccountTranslate,
): FailureView {
  const rules = Array.isArray(record.rules)
    ? record.rules.filter((rule): rule is string => typeof rule === "string")
    : [];
  return {
    message: t(ACCOUNT_KEYS.policyIntro),
    rules: rules.map((rule) => ruleText(rule, t)),
    fields: ["password"],
  };
}

/**
 * 严格按契约 §1 响应矩阵映射，不自造错误码。
 *
 * 401 的两种「凭据错」要分开：`invalid_totp` 指向动态码，`invalid_credentials` 才是
 * 当前口令错；`unauthorized` 是会话失效，给「重新登录」而不是把口令框标红。
 * 403 只认 `bad_origin`（跨源提交被拒），其余 4xx 与 text/plain 响应走 generic。
 */
function describeFailure(status: number, body: unknown, t: AccountTranslate): FailureView {
  const record: Unchecked<PasswordChangeErrorBody> = isRecord<PasswordChangeErrorBody>(body)
    ? body
    : {};
  if (status === 401) {
    if (isError(record.error, "invalid_totp")) {
      return { message: t(ACCOUNT_KEYS.invalidTotp), rules: [], fields: ["code"] };
    }
    if (isError(record.error, "invalid_credentials")) {
      return { message: t(ACCOUNT_KEYS.invalidCredentials), rules: [], fields: ["current"] };
    }
    // `unauthorized`、无 body、代理/未来新增的 401 码：一律按会话失效处理。
    // 绝不能落到「当前密码错误」：用户会拿着正确口令无限重试（C1/P2）。
    return { message: t(ACCOUNT_KEYS.expired), rules: [], fields: [], relogin: true };
  }
  if (status === 400 && isError(record.error, "policy")) return describePolicy(record, t);
  if (status === 403 && isError(record.error, "bad_origin")) {
    return { message: t(ACCOUNT_KEYS.badOrigin), rules: [], fields: [] };
  }
  if (status === 429) {
    return typeof record.retryAfter === "number"
      ? { message: t(ACCOUNT_KEYS.locked, { seconds: record.retryAfter }), rules: [], fields: [] }
      : { message: t(ACCOUNT_KEYS.lockedPlain), rules: [], fields: [] };
  }
  if (status === 503) return { message: t(ACCOUNT_KEYS.unavailable), rules: [], fields: [] };
  return { message: t(ACCOUNT_KEYS.generic), rules: [], fields: [] };
}

/** 提交请求：URLSearchParams 原样编码；code 恒带上（TOTP 未开启时为空串）。 */
function postPassword(values: FormValues, signal: AbortSignal): Promise<Response> {
  const request: PasswordChangeRequest = {
    current: values.current,
    password: values.password,
    code: values.code,
  };
  return fetch(PASSWORD_TARGET, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: encodeForm(request),
    signal,
    credentials: "same-origin",
  });
}

/** 提交结果：成功 / 契约 §1 映射出的失败 / 已中止（卸载后连响应体都不再解析）。 */
export type PasswordSubmitResult =
  { kind: "ok" } | { kind: "failure"; failure: FailureView } | { kind: "aborted" };

/** 发一次改密请求并按响应矩阵翻译；中途 abort 则立刻收手。 */
export async function submitPassword(
  values: FormValues,
  signal: AbortSignal,
  t: AccountTranslate,
): Promise<PasswordSubmitResult> {
  const res = await postPassword(values, signal);
  if (signal.aborted) return { kind: "aborted" };
  if (res.ok) return { kind: "ok" };
  const body = await readJsonSafe(res);
  if (signal.aborted) return { kind: "aborted" };
  return { kind: "failure", failure: describeFailure(res.status, body, t) };
}
