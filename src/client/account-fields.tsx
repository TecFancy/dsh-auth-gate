import { ACCOUNT_KEYS, type AccountTranslate } from "./account-copy.ts";
import type { FailureView, FieldName, FormValues } from "./account-submit.ts";
import {
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  INPUT_STYLE,
  INVALID_INPUT_STYLE,
  LABEL_STYLE,
  RULES_STYLE,
  STATUS_STYLE,
} from "./account-styles.ts";

/** 字段/节点 id 前缀（一个面板只有一个实例，静态 id 即可）。 */
const PREFIX = "dsh-auth-gate-account";

/** 状态区 id：aria-live 播报位，也是错误字段 aria-describedby 的落点（成功态复用）。 */
export const ACCOUNT_STATUS_ID = `${PREFIX}-status`;

/** 动态验证码输入提示 id。 */
const CODE_HINT_ID = `${PREFIX}-code-hint`;

/** 字段 id（label htmlFor / aria 关联复用）。 */
function fieldId(name: FieldName): string {
  return `${PREFIX}-${name}`;
}

interface FieldProps {
  id: string;
  name: FieldName;
  label: string;
  type: "password" | "text";
  autoComplete: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  hint?: string | undefined;
  hintId?: string | undefined;
  inputMode?: "numeric" | undefined;
}

/** 带 label / 错误描边 / aria 关联的输入行。 */
function Field({
  id,
  name,
  label,
  type,
  autoComplete,
  value,
  invalid,
  onChange,
  hint,
  hintId,
  inputMode,
}: FieldProps) {
  const described = [invalid ? ACCOUNT_STATUS_ID : undefined, hintId].filter(
    (item): item is string => item !== undefined,
  );
  return (
    <div style={LABEL_STYLE}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
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

interface PasswordFieldsProps {
  t: AccountTranslate;
  values: FormValues;
  isInvalid: (field: FieldName) => boolean;
  onChange: (field: FieldName, value: string) => void;
}

/** 四字段（current / password / confirm / code），autocomplete 按语义固定。 */
export function PasswordFields({ t, values, isInvalid, onChange }: PasswordFieldsProps) {
  return (
    <>
      <Field
        id={fieldId("current")}
        name="current"
        label={t(ACCOUNT_KEYS.current)}
        type="password"
        autoComplete="current-password"
        value={values.current}
        invalid={isInvalid("current")}
        onChange={(value) => onChange("current", value)}
      />
      <Field
        id={fieldId("password")}
        name="password"
        label={t(ACCOUNT_KEYS.password)}
        type="password"
        autoComplete="new-password"
        value={values.password}
        invalid={isInvalid("password")}
        onChange={(value) => onChange("password", value)}
      />
      <Field
        id={fieldId("confirm")}
        name="confirm"
        label={t(ACCOUNT_KEYS.confirm)}
        type="password"
        autoComplete="new-password"
        value={values.confirm}
        invalid={isInvalid("confirm")}
        onChange={(value) => onChange("confirm", value)}
      />
      <Field
        id={fieldId("code")}
        name="code"
        label={t(ACCOUNT_KEYS.code)}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={values.code}
        invalid={isInvalid("code")}
        hint={t(ACCOUNT_KEYS.codeHint)}
        hintId={CODE_HINT_ID}
        onChange={(value) => onChange("code", value)}
      />
    </>
  );
}

/** 状态区：常驻 DOM 的 aria-live 播报位（idle 时留空，避免读屏漏播）。 */
export function StatusLine({ failure }: { failure: FailureView | null }) {
  return (
    <div id={ACCOUNT_STATUS_ID} role="status" aria-live="polite" style={STATUS_STYLE}>
      {failure === null ? null : <span style={ERROR_TEXT_STYLE}>{failure.message}</span>}
      {failure === null || failure.rules.length === 0 ? null : (
        <ul style={RULES_STYLE}>
          {failure.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
