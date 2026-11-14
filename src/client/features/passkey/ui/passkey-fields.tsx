/**
 * passkey 区块的共享展示件：id 常量、输入行、状态播报位。
 *
 * 只被 `passkey-block.tsx` / `passkey-settings-toggle.tsx` 单向 import；本文件不 import 它们
 * （避免循环）。样式全部复用 `shared/ui` 的既有常量，不新增视觉语言。
 */
import type { PasskeyField, PasskeyFailureView } from "../model/passkey-form.ts";
import {
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  INPUT_STYLE,
  INVALID_INPUT_STYLE,
  LABEL_STYLE,
  STATUS_STYLE,
  SUCCESS_TEXT_STYLE,
} from "../../../shared/ui/index.ts";

/** id 前缀（一个面板只有一个 passkey 区块实例，静态 id 即可）。 */
const PREFIX = "dsh-auth-gate-passkey";

/** 状态播报位：aria-live 落点，也是错误字段 aria-describedby 的目标。 */
export const PASSKEY_STATUS_ID = `${PREFIX}-status`;
export const PASSKEY_CODE_HINT_ID = `${PREFIX}-code-hint`;

/** 字段 id（label htmlFor / aria 关联复用）。 */
export function passkeyFieldId(field: PasskeyField): string {
  return `${PREFIX}-${field}`;
}

/** 带 label / 错误描边 / aria 关联的输入行。 */
export function PasskeyTextField({
  field,
  label,
  type,
  autoComplete,
  value,
  invalid,
  onChange,
  hint,
  hintId,
  inputMode,
}: {
  field: PasskeyField;
  label: string;
  type: "text" | "password";
  autoComplete: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  hint?: string | undefined;
  hintId?: string | undefined;
  inputMode?: "numeric" | undefined;
}) {
  const described = [invalid ? PASSKEY_STATUS_ID : undefined, hintId].filter(
    (item): item is string => item !== undefined,
  );
  const id = passkeyFieldId(field);
  return (
    <div style={LABEL_STYLE}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={field}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
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

/** 状态区：失败消息（错误色）+ 就地成功文案（成功色），常驻 aria-live 播报位。 */
export function PasskeyStatus({
  failure,
  success,
}: {
  failure: PasskeyFailureView | null;
  success: string | null;
}) {
  return (
    <div id={PASSKEY_STATUS_ID} role="status" aria-live="polite" style={STATUS_STYLE}>
      {failure === null ? null : <span style={ERROR_TEXT_STYLE}>{failure.message}</span>}
      {success === null ? null : <span style={SUCCESS_TEXT_STYLE}>{success}</span>}
    </div>
  );
}
