import { ACCOUNT_KEYS, ruleText, type AccountTranslate } from "./account-copy.ts";

/** 自助改密端点（契约 §1：POST + application/x-www-form-urlencoded）。 */
const PASSWORD_TARGET = "/auth/password";

/** 四个字段：契约 §1 只收 current/password/code，confirm 只在客户端比对。 */
export type FieldName = "current" | "password" | "confirm" | "code";

export type FormValues = Record<FieldName, string>;

export const EMPTY_VALUES: FormValues = { current: "", password: "", confirm: "", code: "" };

/** 失败视图：消息 + 逐条策略规则 + 需要标红的字段。 */
export interface FailureView {
  message: string;
  rules: string[];
  fields: FieldName[];
}

/** 契约 §1 的 JSON 失败体（503 是 text/plain，走空体 + 状态码兜底）。 */
interface FailureBody {
  error?: unknown;
  rules?: unknown;
  retryAfter?: unknown;
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

/** 读失败体；解析失败返回空体，映射只看状态码。 */
async function readFailureBody(res: Response): Promise<FailureBody> {
  try {
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null ? body : {};
  } catch {
    return {};
  }
}

/** 严格按契约 §1 响应矩阵映射，不自造错误码。 */
function describeFailure(status: number, body: FailureBody, t: AccountTranslate): FailureView {
  if (status === 401) {
    return body.error === "invalid_totp"
      ? { message: t(ACCOUNT_KEYS.invalidTotp), rules: [], fields: ["code"] }
      : { message: t(ACCOUNT_KEYS.invalidCredentials), rules: [], fields: ["current"] };
  }
  if (status === 400 && body.error === "policy") {
    const rules = Array.isArray(body.rules)
      ? body.rules.filter((rule): rule is string => typeof rule === "string")
      : [];
    return {
      message: t(ACCOUNT_KEYS.policyIntro),
      rules: rules.map((rule) => ruleText(rule, t)),
      fields: ["password"],
    };
  }
  if (status === 429) {
    return typeof body.retryAfter === "number"
      ? { message: t(ACCOUNT_KEYS.locked, { seconds: body.retryAfter }), rules: [], fields: [] }
      : { message: t(ACCOUNT_KEYS.lockedPlain), rules: [], fields: [] };
  }
  if (status === 503) {
    return { message: t(ACCOUNT_KEYS.unavailable), rules: [], fields: [] };
  }
  return { message: t(ACCOUNT_KEYS.generic), rules: [], fields: [] };
}

/** 提交请求：URLSearchParams 原样编码；code 恒带上（TOTP 未开启时为空串）。 */
function postPassword(values: FormValues, signal: AbortSignal): Promise<Response> {
  const body = new URLSearchParams();
  body.set("current", values.current);
  body.set("password", values.password);
  body.set("code", values.code);
  return fetch(PASSWORD_TARGET, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
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
  const body = await readFailureBody(res);
  if (signal.aborted) return { kind: "aborted" };
  return { kind: "failure", failure: describeFailure(res.status, body, t) };
}
