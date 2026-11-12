/**
 * 「添加通行密钥」表单（M6 PR3）：名称 + 当前口令 + 可选 TOTP 码。
 *
 * 再认证是安全红线：会话本身不足以注册（防「会话被劫 → 加后门 passkey」），
 * 所以口令字段必填，TOTP 码在服务端开启两步验证时必填（客户端不判断，留空即不发）。
 */
import type { FormEvent } from "react";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import { BUTTON_BUSY_STYLE, BUTTON_STYLE, FORM_STYLE } from "../../../shared/ui/index.ts";
import type { PasskeyField, PasskeyFormValues } from "../model/passkey-form.ts";
import { PASSKEY_CODE_HINT_ID, PasskeyTextField } from "./passkey-fields.tsx";

export interface PasskeyAddFormProps {
  t: AccountTranslate;
  values: PasskeyFormValues;
  invalid: PasskeyField[];
  busy: boolean;
  onChange: (field: PasskeyField, value: string) => void;
  /** 提交回调：父组件的状态机自己吞掉 Promise（表单只负责触发）。 */
  onSubmit: () => void | Promise<void>;
}

/** 添加表单：提交由父组件的状态机接管（校验、双锁、abort 都在那里）。 */
export function PasskeyAddForm({
  t,
  values,
  invalid,
  busy,
  onChange,
  onSubmit,
}: PasskeyAddFormProps) {
  const isInvalid = (field: PasskeyField): boolean => invalid.includes(field);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void onSubmit();
  };
  return (
    <form style={FORM_STYLE} noValidate aria-busy={busy} onSubmit={submit}>
      <PasskeyTextField
        field="label"
        label={t(PASSKEY_KEYS.label)}
        type="text"
        autoComplete="off"
        value={values.label}
        invalid={isInvalid("label")}
        onChange={(value) => onChange("label", value)}
      />
      <PasskeyTextField
        field="password"
        label={t(PASSKEY_KEYS.password)}
        type="password"
        autoComplete="current-password"
        value={values.password}
        invalid={isInvalid("password")}
        onChange={(value) => onChange("password", value)}
        hint={t(PASSKEY_KEYS.passwordHint)}
      />
      <PasskeyTextField
        field="code"
        label={t(PASSKEY_KEYS.code)}
        type="text"
        autoComplete="one-time-code"
        inputMode="numeric"
        value={values.code}
        invalid={isInvalid("code")}
        onChange={(value) => onChange("code", value)}
        hint={t(PASSKEY_KEYS.codeHint)}
        hintId={PASSKEY_CODE_HINT_ID}
      />
      <button type="submit" disabled={busy} style={busy ? BUTTON_BUSY_STYLE : BUTTON_STYLE}>
        {busy ? t(PASSKEY_KEYS.adding) : t(PASSKEY_KEYS.add)}
      </button>
    </form>
  );
}
