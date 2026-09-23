import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { ACCOUNT_KEYS, type AccountTranslate } from "./account-copy.ts";
import { ACCOUNT_STATUS_ID, PasswordFields, StatusLine } from "./account-fields.tsx";
import {
  BUTTON_BUSY_STYLE,
  BUTTON_STYLE,
  FORM_STYLE,
  HINT_STYLE,
  PANEL_STYLE,
  SUCCESS_TEXT_STYLE,
  TITLE_STYLE,
} from "./account-styles.ts";
import {
  EMPTY_VALUES,
  submitPassword,
  validate,
  type FailureView,
  type FieldName,
  type FormValues,
} from "./account-submit.ts";

/** 提交控制器：四种 UI 状态 = idle/submitting(lock)/ok(success)/error(failure)。 */
interface PasswordChangeController {
  values: FormValues;
  submitting: boolean;
  failure: FailureView | null;
  success: string | null;
  composing: MutableRefObject<boolean>;
  setValue: (field: FieldName, value: string) => void;
  submit: () => Promise<void>;
}

/**
 * 表单状态机：
 * - 双锁 = in-flight ref（硬锁，Enter/点击并发都挡）+ submitting 按钮 disabled（可见锁）；
 * - IME 组合期由 composing ref 挡住，避免中文输入法确认键提交；
 * - 请求带 AbortController，卸载即 abort，回调再看 mounted，绝不卸载后 setState。
 */
function usePasswordChange(t: AccountTranslate): PasswordChangeController {
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const lock = useRef(false);
  const composing = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const setValue = (field: FieldName, value: string): void => {
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  const submit = async (): Promise<void> => {
    if (lock.current) return;
    const invalid = validate(values, t);
    if (invalid !== null) {
      setFailure(invalid);
      return;
    }
    lock.current = true;
    setSubmitting(true);
    setFailure(null);
    const controller = new AbortController();
    abort.current = controller;
    const live = (): boolean => mounted.current && !controller.signal.aborted;
    try {
      const result = await submitPassword(values, controller.signal, t);
      if (!live()) return;
      if (result.kind === "ok") {
        setSuccess(t(ACCOUNT_KEYS.success));
        return;
      }
      if (result.kind === "failure") setFailure(result.failure);
    } catch {
      if (!live()) return;
      setFailure({ message: t(ACCOUNT_KEYS.generic), rules: [], fields: [] });
    } finally {
      lock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  return { values, submitting, failure, success, composing, setValue, submit };
}

/** 改密表单 props：`t` 来自槽位 locale seat，`close` 是宿主 owner props。 */
export interface AccountPasswordFormProps {
  t: AccountTranslate;
  close?: (() => void) | undefined;
}

/** 已登录时的自助改密表单（成功后整页换成提示 + owner 的 close 按钮）。 */
export function AccountPasswordForm({ t, close }: AccountPasswordFormProps) {
  const form = usePasswordChange(t);
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (form.composing.current) return;
    void form.submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (form.composing.current || event.nativeEvent.isComposing) return;
    void form.submit();
  };
  if (form.success !== null) {
    return (
      <section style={PANEL_STYLE}>
        <h2 style={TITLE_STYLE}>{t(ACCOUNT_KEYS.title)}</h2>
        <p id={ACCOUNT_STATUS_ID} role="status" aria-live="polite" style={SUCCESS_TEXT_STYLE}>
          {form.success}
        </p>
        {typeof close === "function" ? (
          <button type="button" onClick={close} style={BUTTON_STYLE}>
            {t(ACCOUNT_KEYS.close)}
          </button>
        ) : null}
      </section>
    );
  }
  const isInvalid = (field: FieldName): boolean => form.failure?.fields.includes(field) === true;
  return (
    <section style={PANEL_STYLE}>
      <h2 style={TITLE_STYLE}>{t(ACCOUNT_KEYS.title)}</h2>
      <p style={HINT_STYLE}>{t(ACCOUNT_KEYS.intro)}</p>
      <form
        style={FORM_STYLE}
        noValidate
        aria-busy={form.submitting}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          form.composing.current = true;
        }}
        onCompositionEnd={() => {
          form.composing.current = false;
        }}
      >
        <PasswordFields t={t} values={form.values} isInvalid={isInvalid} onChange={form.setValue} />
        <StatusLine failure={form.failure} />
        <button
          type="submit"
          disabled={form.submitting}
          style={form.submitting ? BUTTON_BUSY_STYLE : BUTTON_STYLE}
        >
          {form.submitting ? t(ACCOUNT_KEYS.submitting) : t(ACCOUNT_KEYS.submit)}
        </button>
      </form>
    </section>
  );
}
