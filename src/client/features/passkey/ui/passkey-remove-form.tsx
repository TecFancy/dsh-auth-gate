/**
 * 删除通行密钥的就地确认区（重设计 2026-11-16）。
 *
 * 为什么不是 `window.confirm`：确认区要承载再认证字段（当前口令 + 动态码）、持久错误
 * 和明确的「删的是哪一把」；`confirm` 三样都做不到，而且会打断焦点。
 *
 * 为什么不是 modal：当前技术形态没有 portal，行内确认能保持目标上下文（用户刚点的那一行
 * 就在上面），也少一层焦点陷阱。
 *
 * 安全细节：安全动作（取消）在左、危险动作（确认删除）在右，避免双击在同一坐标直接完成
 * 破坏；打开时焦点落在口令框，不是危险按钮。
 */
import {
  useEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type Ref,
} from "react";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ActionButton,
  CONFIRM_ACTIONS_STYLE,
  CONFIRM_PANEL_STYLE,
  CONFIRM_TITLE_STYLE,
  CONFIRM_WARNING_STYLE,
  FIELD_CONTROL_STYLE,
  FIELD_LABEL_STYLE,
  FIELD_ROW_STYLE,
  HINT_STYLE,
  ROW_INPUT_STYLE,
  ROW_INVALID_INPUT_STYLE,
} from "../../../shared/ui/index.ts";
import {
  PASSKEY_STATUS_ID,
  passkeyReauthFieldId,
  type PasskeyReauthValues,
} from "../model/passkey-form.ts";

/** 动态码提示 id。 */
const CODE_HINT_ID = "dsh-auth-gate-passkey-remove-code-hint";

export interface PasskeyRemoveFormProps {
  t: AccountTranslate;
  /** 要删的凭据名称（显示在标题里，让用户确认删的是哪一把）。 */
  label: string;
  values: PasskeyReauthValues;
  /** 需要标红的字段。 */
  invalid: ("label" | "password" | "code")[];
  /** 请求在飞。 */
  busy: boolean;
  /** 当前账号是否开启两步验证：决定动态码框的提示文案。 */
  totpEnabled?: boolean | undefined;
  onChange: (field: "password" | "code", value: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

/** 行式输入（与改密表单同形，但 id 前缀是删除专用）。 */
function ReauthField({
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
  field: "password" | "code";
  label: string;
  type: "password" | "text";
  autoComplete: string;
  value: string;
  invalid: boolean;
  hint?: string | undefined;
  hintId?: string | undefined;
  inputMode?: "numeric" | undefined;
  onChange: (value: string) => void;
}) {
  const id = passkeyReauthFieldId(field);
  const described = [invalid ? PASSKEY_STATUS_ID : undefined, hintId].filter(
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

/** 表单提交：IME 组合期内的确认键是「确认候选词」，不是提交（C6）。 */
function submitHandler(
  event: FormEvent<HTMLFormElement>,
  composing: MutableRefObject<boolean>,
  onConfirm: () => void | Promise<void>,
): void {
  event.preventDefault();
  if (composing.current) return;
  void onConfirm();
}

/** Enter 键路径：组合期内直接忽略，其余等同提交。 */
function keyDownHandler(
  event: KeyboardEvent<HTMLFormElement>,
  composing: MutableRefObject<boolean>,
  onConfirm: () => void | Promise<void>,
): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (composing.current || event.nativeEvent.isComposing === true) return;
  void onConfirm();
}

/** 口令行：打开确认区时聚焦的第一个字段（不落在危险按钮上）。 */
function ReauthPasswordField({
  t,
  value,
  invalid,
  inputRef,
  onChange,
}: {
  t: AccountTranslate;
  value: string;
  invalid: boolean;
  inputRef: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
}) {
  return (
    <div style={FIELD_ROW_STYLE}>
      <label htmlFor={passkeyReauthFieldId("password")} style={FIELD_LABEL_STYLE}>
        {t(PASSKEY_KEYS.password)}
      </label>
      <div style={FIELD_CONTROL_STYLE}>
        <input
          ref={inputRef}
          id={passkeyReauthFieldId("password")}
          name="password"
          type="password"
          autoComplete="current-password"
          value={value}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={invalid ? PASSKEY_STATUS_ID : undefined}
          style={invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

/** 删除确认区：标题（含凭据名）+ 后果说明 + 再认证字段 + 取消/确认。 */
export function PasskeyRemoveForm({
  t,
  label,
  values,
  invalid,
  busy,
  totpEnabled,
  onChange,
  onCancel,
  onConfirm,
}: PasskeyRemoveFormProps) {
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);

  // 打开即聚焦口令框：键盘用户不用自己找，焦点也不落在危险按钮上。
  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const isInvalid = (field: "password" | "code"): boolean => invalid.includes(field);
  const codeHint =
    totpEnabled === undefined
      ? t(PASSKEY_KEYS.codeHint)
      : t(totpEnabled ? PASSKEY_KEYS.codeHintOn : PASSKEY_KEYS.codeHintOff);
  return (
    <form
      style={CONFIRM_PANEL_STYLE}
      noValidate
      aria-busy={busy}
      onSubmit={(event) => submitHandler(event, composing, onConfirm)}
      onKeyDown={(event) => keyDownHandler(event, composing, onConfirm)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    >
      <h4 style={CONFIRM_TITLE_STYLE}>{t(PASSKEY_KEYS.removeTitle, { label })}</h4>
      <p style={CONFIRM_WARNING_STYLE}>{t(PASSKEY_KEYS.removeWarning)}</p>
      <div>
        <ReauthPasswordField
          t={t}
          value={values.password}
          invalid={isInvalid("password")}
          inputRef={passwordRef}
          onChange={(value) => onChange("password", value)}
        />
        <ReauthField
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
      <div style={CONFIRM_ACTIONS_STYLE}>
        <ActionButton variant="ghost" onClick={onCancel} disabled={busy}>
          {t(PASSKEY_KEYS.cancel)}
        </ActionButton>
        <ActionButton variant="danger" type="submit" busy={busy}>
          {busy ? t(PASSKEY_KEYS.removing) : t(PASSKEY_KEYS.removeConfirm)}
        </ActionButton>
      </div>
    </form>
  );
}
