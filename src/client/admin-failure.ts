import { ruleText } from "./account-copy.ts";
import { ADMIN_KEYS, type AdminTranslate } from "./admin-copy.ts";
import type { AdminFailureView, AdminField } from "./admin-types.ts";

/**
 * 管理重置的失败映射（CONTRACT-pr2 §1.3 + §9/A10）。从 `admin-api.ts` 预拆出来（A12），
 * 避免单文件贴上限。**全函数**：只认下表的 (status, error) 字面量组合，
 * 其余一律 `admin.generic`，不自造错误码、不做前缀/子串匹配。
 *
 * 已核对 PR1：`self`（自助误走管理面）也回 `{error:"forbidden"}`，没有 `{error:"self"}`。
 */

function view(message: string, rules: string[] = [], fields: AdminField[] = []): AdminFailureView {
  return { message, rules, fields };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 规则列表：只保留字符串项，未知规则名原样回显（复用 account 的 `ruleText`）。 */
function ruleList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((rule): rule is string => typeof rule === "string")
    : [];
}

/** 400：`bad_target` / `policy`（携带 rules）；其余（含缺 error）→ generic。 */
function describeBadRequest(error: unknown, rules: unknown, t: AdminTranslate): AdminFailureView {
  if (error === "policy") {
    return view(
      t(ADMIN_KEYS.policyIntro),
      ruleList(rules).map((rule) => ruleText(rule, t)),
      ["password"],
    );
  }
  if (error === "bad_target") return view(t(ADMIN_KEYS.badTarget), [], ["target"]);
  return view(t(ADMIN_KEYS.generic));
}

/** 401：`invalid_totp` / `unauthorized`；其余 → generic。 */
function describeUnauthorized(error: unknown, t: AdminTranslate): AdminFailureView {
  if (error === "invalid_totp") return view(t(ADMIN_KEYS.invalidTotp), [], ["code"]);
  if (error === "unauthorized") return view(t(ADMIN_KEYS.unauthorized));
  return view(t(ADMIN_KEYS.generic));
}

/** 429：`locked` + 数字 retryAfter 插值，缺数字用无参文案；其余 → generic。 */
function describeLocked(error: unknown, retryAfter: unknown, t: AdminTranslate): AdminFailureView {
  if (error !== "locked") return view(t(ADMIN_KEYS.generic));
  return typeof retryAfter === "number"
    ? view(t(ADMIN_KEYS.locked, { seconds: retryAfter }))
    : view(t(ADMIN_KEYS.lockedPlain));
}

/**
 * 状态码矩阵 → 文案键：
 * 400 bad_target / policy+rules、401 invalid_totp / unauthorized、403 forbidden、
 * 404 not_found、429 locked(+retryAfter)、其余（413/415/503 的 text/plain 与所有未列出组合，
 * 含缺 `error` 的 403/404/429）一律 generic。
 */
export function describeAdminFailure(
  status: number,
  body: unknown,
  t: AdminTranslate,
): AdminFailureView {
  const record = isRecord(body) ? body : {};
  const error = record["error"];
  if (status === 400) return describeBadRequest(error, record["rules"], t);
  if (status === 401) return describeUnauthorized(error, t);
  if (status === 403 && error === "forbidden") return view(t(ADMIN_KEYS.forbidden));
  if (status === 404 && error === "not_found") return view(t(ADMIN_KEYS.notFound), [], ["target"]);
  if (status === 429) return describeLocked(error, record["retryAfter"], t);
  return view(t(ADMIN_KEYS.generic));
}
