import type { AdminFailureView, AdminField } from "./admin-types.ts";
import {
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  INPUT_STYLE,
  INVALID_INPUT_STYLE,
  LABEL_STYLE,
  RULES_STYLE,
  STATUS_STYLE,
  SUCCESS_TEXT_STYLE,
} from "./account-styles.ts";

/**
 * 管理块的共享展示件（lead 批的 A12 预拆）：id 常量 + 输入行 + 状态播报位。
 * 只被 `admin-form.tsx` / `admin-block.tsx` **单向** import；本文件不 import 它们（避免循环）。
 */

/** id 前缀冻结（契约 §3.10）：一个面板只有一个管理块实例，静态 id 即可。 */
const PREFIX = "dsh-auth-gate-admin";

/** 状态播报位：aria-live 落点，也是错误字段 aria-describedby 的目标。 */
export const ADMIN_STATUS_ID = `${PREFIX}-status`;
export const ADMIN_CODE_HINT_ID = `${PREFIX}-code-hint`;

export function adminFieldId(field: AdminField): string {
  return `${PREFIX}-${field}`;
}

/** 成功视图（A8）：`warning` = `sessionsRevoked:false`，是安全失败，走 alert + 错误色。 */
export interface AdminSuccessView {
  text: string;
  warning: boolean;
}

/** 带 label / 错误描边 / aria 关联的输入行（与自助面同范式，id 换管理块前缀）。 */
export function AdminTextField({
  field,
  label,
  value,
  invalid,
  onChange,
  hint,
  hintId,
}: {
  field: AdminField;
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  hint?: string | undefined;
  hintId?: string | undefined;
}) {
  const described = [invalid ? ADMIN_STATUS_ID : undefined, hintId].filter(
    (item) => item !== undefined,
  );
  const id = adminFieldId(field);
  // 字段语义固定：新口令两框 `new-password`，动态码 `one-time-code` + 数字键盘。
  const isCode = field === "code";
  return (
    <div style={LABEL_STYLE}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={field}
        type={isCode ? "text" : "password"}
        value={value}
        autoComplete={isCode ? "one-time-code" : "new-password"}
        inputMode={isCode ? "numeric" : undefined}
        aria-invalid={invalid ? "true" : undefined}
        aria-describedby={described.length === 0 ? undefined : described.join(" ")}
        style={invalid ? INVALID_INPUT_STYLE : INPUT_STYLE}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint === undefined ? null : (
        <span id={hintId} style={HINT_STYLE}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** 状态区：失败消息 + 已翻译规则列表 + 就地成功/警告文案（契约 §3.8 / A8）。 */
export function AdminStatus({
  failure,
  success,
}: {
  failure: AdminFailureView | null;
  success: AdminSuccessView | null;
}) {
  const warning = success?.warning === true;
  return (
    <>
      <div id={ADMIN_STATUS_ID} role="status" aria-live="polite" style={STATUS_STYLE}>
        {failure === null ? null : <span style={ERROR_TEXT_STYLE}>{failure.message}</span>}
        {failure === null || failure.rules.length === 0 ? null : (
          <ul style={RULES_STYLE}>
            {failure.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        )}
        {success === null || warning ? null : (
          <span style={SUCCESS_TEXT_STYLE}>{success.text}</span>
        )}
      </div>
      {warning && success !== null ? (
        <p role="alert" aria-live="assertive" style={ERROR_TEXT_STYLE}>
          {success.text}
        </p>
      ) : null}
    </>
  );
}
