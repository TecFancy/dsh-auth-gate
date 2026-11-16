/**
 * 「添加通行密钥」表单（重设计 2026-11-16：默认收起，展开后带标题与取消）。
 *
 * 再认证是安全红线：会话本身不足以注册（防「会话被劫 → 加后门 passkey」），
 * 所以口令字段必填，TOTP 码在服务端开启两步验证时必填（客户端不判断，留空即不发）。
 *
 * 重设计：这个表单一年用一次，常驻展开会占掉约 300px 首屏（评审：低频表单不该和
 * 主任务抢空间）。现在由父组件按需挂载，展开时聚焦名称框，取消后焦点回触发按钮。
 */
import { useEffect, useRef, type FormEvent } from "react";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ActionButton,
  CONFIRM_ACTIONS_STYLE,
  FIELD_CONTROL_STYLE,
  FIELD_LABEL_STYLE,
  FIELD_ROW_STYLE,
  HINT_STYLE,
  ROW_INPUT_STYLE,
  ROW_INVALID_INPUT_STYLE,
  SECTION_HEADING_STYLE,
  TITLE_STYLE,
} from "../../../shared/ui/index.ts";
import type { PasskeyField, PasskeyFormValues } from "../model/passkey-form.ts";

/** 字段 id（与 use-passkey-actions 的 `addFieldId` 同形）。 */
function fieldId(field: PasskeyField): string {
  return `dsh-auth-gate-passkey-${field}`;
}

/** 动态码提示 id。 */
const CODE_HINT_ID = "dsh-auth-gate-passkey-code-hint";

/** 状态播报位 id（与列表共用同一个 passkey 状态位）。 */
const STATUS_ID = "dsh-auth-gate-passkey-status";

/** 行式输入（与改密表单同形）。 */
function AddField({
  field,
  label,
  type,
  autoComplete,
  value,
  invalid,
  hint,
  hintId,
  inputMode,
  onChange,
}: {
  field: PasskeyField;
  label: string;
  type: "text" | "password";
  autoComplete: string;
  value: string;
  invalid: boolean;
  hint?: string | undefined;
  hintId?: string | undefined;
  inputMode?: "numeric" | undefined;
  onChange: (value: string) => void;
}) {
  const id = fieldId(field);
  const described = [invalid ? STATUS_ID : undefined, hintId].filter(
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
          name={field}
          type={type}
          value={value}
          autoComplete={autoComplete}
          inputMode={inputMode}
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

/** 三个字段的组合（名称 / 当前口令 / 动态码）。 */
function AddFields({
  t,
  values,
  isInvalid,
  codeHint,
  labelRef,
  onChange,
}: {
  t: AccountTranslate;
  values: PasskeyFormValues;
  isInvalid: (field: PasskeyField) => boolean;
  codeHint: string;
  labelRef: React.MutableRefObject<HTMLInputElement | null>;
  onChange: (field: PasskeyField, value: string) => void;
}) {
  return (
    <div>
      <div style={FIELD_ROW_STYLE}>
        <label htmlFor={fieldId("label")} style={FIELD_LABEL_STYLE}>
          {t(PASSKEY_KEYS.label)}
        </label>
        <div style={FIELD_CONTROL_STYLE}>
          <input
            ref={labelRef}
            id={fieldId("label")}
            name="label"
            type="text"
            autoComplete="off"
            placeholder={t(PASSKEY_KEYS.labelPlaceholder)}
            value={values.label}
            aria-invalid={isInvalid("label") ? "true" : undefined}
            aria-describedby={isInvalid("label") ? STATUS_ID : undefined}
            style={isInvalid("label") ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE}
            onChange={(event) => onChange("label", event.target.value)}
          />
        </div>
      </div>
      <AddField
        field="password"
        label={t(PASSKEY_KEYS.password)}
        type="password"
        autoComplete="current-password"
        value={values.password}
        invalid={isInvalid("password")}
        hint={t(PASSKEY_KEYS.passwordHint)}
        onChange={(value) => onChange("password", value)}
      />
      <AddField
        field="code"
        label={t(PASSKEY_KEYS.code)}
        type="text"
        autoComplete="one-time-code"
        inputMode="numeric"
        value={values.code}
        invalid={isInvalid("code")}
        hint={codeHint}
        hintId={CODE_HINT_ID}
        onChange={(value) => onChange("code", value)}
      />
    </div>
  );
}

export interface PasskeyAddFormProps {
  t: AccountTranslate;
  values: PasskeyFormValues;
  invalid: PasskeyField[];
  busy: boolean;
  /** 当前账号是否开启两步验证：决定动态码框的提示文案。 */
  totpEnabled?: boolean | undefined;
  onChange: (field: PasskeyField, value: string) => void;
  /** 提交回调：父组件的状态机自己吞掉 Promise（表单只负责触发）。 */
  onSubmit: () => void | Promise<void>;
  /** 收起表单（父组件负责把焦点还给触发按钮）。 */
  onCancel: () => void;
}

/** 添加表单：提交由父组件的状态机接管（校验、双锁、abort 都在那里）。 */
export function PasskeyAddForm({
  t,
  values,
  invalid,
  busy,
  totpEnabled,
  onChange,
  onSubmit,
  onCancel,
}: PasskeyAddFormProps) {
  const labelRef = useRef<HTMLInputElement | null>(null);

  // 展开即聚焦名称框：键盘用户不用自己找。
  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const isInvalid = (field: PasskeyField): boolean => invalid.includes(field);
  const codeHint =
    totpEnabled === undefined
      ? t(PASSKEY_KEYS.codeHint)
      : t(totpEnabled ? PASSKEY_KEYS.codeHintOn : PASSKEY_KEYS.codeHintOff);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void onSubmit();
  };
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      noValidate
      aria-busy={busy}
      onSubmit={submit}
    >
      <div style={SECTION_HEADING_STYLE}>
        <h4 style={TITLE_STYLE}>{t(PASSKEY_KEYS.addFormTitle)}</h4>
      </div>
      <AddFields
        t={t}
        values={values}
        isInvalid={isInvalid}
        codeHint={codeHint}
        labelRef={labelRef}
        onChange={onChange}
      />
      <div style={CONFIRM_ACTIONS_STYLE}>
        <ActionButton variant="ghost" onClick={onCancel} disabled={busy}>
          {t(PASSKEY_KEYS.cancel)}
        </ActionButton>
        <ActionButton type="submit" busy={busy}>
          {busy ? t(PASSKEY_KEYS.adding) : t(PASSKEY_KEYS.add)}
        </ActionButton>
      </div>
    </form>
  );
}
