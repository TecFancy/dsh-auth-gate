/**
 * 改密表单的字段与状态区（重设计 2026-11-16：改成宿主设置页的行式布局）。
 *
 * 结构钉点（测试依赖，不能改）：四个 input 的 `name` 与顺序是
 * `current` / `password` / `confirm` / `code`；`ACCOUNT_STATUS_ID` 是常驻
 * `role="status" aria-live="polite"` 节点，也是错误字段 `aria-describedby` 的落点。
 *
 * 重设计新增：新密码框下常驻策略说明（原来只在失败后才说）、动态码提示按
 * `totpEnabled` 状态化（原来恒说「已开启时填写」，未开启的用户会以为要填）。
 */
import { ACCOUNT_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import type { FailureView, FieldName, FormValues } from "../model/account-submit.ts";
import {
  ERROR_TEXT_STYLE,
  FIELD_CONTROL_STYLE,
  FIELD_LABEL_STYLE,
  FIELD_ROW_STYLE,
  HINT_STYLE,
  ROW_INPUT_STYLE,
  ROW_INVALID_INPUT_STYLE,
  RULES_STYLE,
  STATUS_STYLE,
} from "../../../shared/ui/index.ts";

/** 字段/节点 id 前缀（一个面板只有一个实例，静态 id 即可）。 */
const PREFIX = "dsh-auth-gate-account";

/** 状态区 id：aria-live 播报位，也是错误字段 aria-describedby 的落点（成功态复用）。 */
export const ACCOUNT_STATUS_ID = `${PREFIX}-status`;

/** 动态验证码输入提示 id。 */
const CODE_HINT_ID = `${PREFIX}-code-hint`;

/** 新密码策略说明 id（常驻，不是错误态才出现）。 */
const POLICY_HINT_ID = `${PREFIX}-policy-hint`;

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
  /** 请求在飞时只读（防快照漂移），不禁用（禁用会丢焦点）。 */
  readOnly?: boolean | undefined;
}

/** 行式字段：左标签 + 右控件（输入 + 帮助文本）。 */
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
  readOnly,
}: FieldProps) {
  const described = [invalid ? ACCOUNT_STATUS_ID : undefined, hintId].filter(
    (item): item is string => item !== undefined,
  );
  return (
    <div style={FIELD_ROW_STYLE}>
      <label htmlFor={id} style={FIELD_LABEL_STYLE}>
        {label}
      </label>
      <div style={FIELD_CONTROL_STYLE}>
        <input
          id={id}
          name={name}
          type={type}
          value={value}
          autoComplete={autoComplete}
          inputMode={inputMode}
          readOnly={readOnly}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={described.length === 0 ? undefined : described.join(" ")}
          style={invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE}
          onChange={(event) => onChange(event.target.value)}
        />
        {hint === undefined ? null : (
          <span id={hintId} style={HINT_STYLE}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

interface PasswordFieldsProps {
  t: AccountTranslate;
  values: FormValues;
  isInvalid: (field: FieldName) => boolean;
  onChange: (field: FieldName, value: string) => void;
  /** 请求在飞：四个输入只读。 */
  readOnly?: boolean | undefined;
  /**
   * 当前账号是否开启两步验证。`undefined` = 不知道（旧服务端），此时沿用
   * 「已开启时填写」的保守文案，不推断成关闭。
   */
  totpEnabled?: boolean | undefined;
}

/** 四字段（current / password / confirm / code），autocomplete 按语义固定。 */
export function PasswordFields({
  t,
  values,
  isInvalid,
  onChange,
  readOnly,
  totpEnabled,
}: PasswordFieldsProps) {
  const codeHint =
    totpEnabled === undefined
      ? t(ACCOUNT_KEYS.codeHint)
      : t(totpEnabled ? ACCOUNT_KEYS.codeHintOn : ACCOUNT_KEYS.codeHintOff);
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
        readOnly={readOnly}
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
        readOnly={readOnly}
        hint={t(ACCOUNT_KEYS.policyHint)}
        hintId={POLICY_HINT_ID}
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
        readOnly={readOnly}
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
        readOnly={readOnly}
        hint={codeHint}
        hintId={CODE_HINT_ID}
        onChange={(value) => onChange("code", value)}
      />
    </>
  );
}

/**
 * 状态区：常驻 DOM 的 aria-live 播报位（idle 时留空，避免读屏漏播）。
 *
 * `tabIndex={-1}` 让无字段的全局错误（429 / 503 / 网络）能把焦点落到这里，
 * 读屏用户不用自己找（评审 F4 的焦点落点）。
 */
export function StatusLine({ failure }: { failure: FailureView | null }) {
  return (
    <div id={ACCOUNT_STATUS_ID} role="status" aria-live="polite" tabIndex={-1} style={STATUS_STYLE}>
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
