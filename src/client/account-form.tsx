import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { ACCOUNT_KEYS, type AccountTranslate } from "./account-copy.ts";
import { ACCOUNT_ICON_PATHS, ACCOUNT_ICON_VIEW_BOX } from "./account-icon.ts";
import { redirectToLogin } from "./account-redirect.ts";
import { ACCOUNT_STATUS_ID, PasswordFields, StatusLine } from "./account-fields.tsx";
import {
  BUTTON_BUSY_STYLE,
  BUTTON_STYLE,
  FORM_STYLE,
  HINT_STYLE,
  PANEL_STYLE,
  SUCCESS_TEXT_STYLE,
  TITLE_ROW_STYLE,
} from "./account-styles.ts";
import {
  EMPTY_VALUES,
  submitPassword,
  validate,
  type FailureView,
  type FieldName,
  type FormValues,
} from "./account-submit.ts";

/**
 * 本插件自设计的图标（P1.1 / D24）：盾 + 钥匙孔，16px outline。
 *
 * 内容区标题行这一份是**我们自己的 React 树**：不依赖宿主任何内部结构，可测、可卸载。
 * 导航行那一份由 `account-nav-icon.ts` 的临时 DOM 垫片贴上去（宿主没有 `icon` 挂载点，
 * 见 D24.1）。两处共用 `account-icon.ts` 的路径数据，与 `docs/demo/account-security.svg` 同源。
 */
function AccountIcon() {
  return (
    <svg
      viewBox={ACCOUNT_ICON_VIEW_BOX}
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ACCOUNT_ICON_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** 提交控制器：四种 UI 状态 = idle/submitting(lock)/ok(success)/error(failure)。 */
interface PasswordChangeController {
  values: FormValues;
  submitting: boolean;
  failure: FailureView | null;
  success: string | null;
  composing: MutableRefObject<boolean>;
  setValue: (field: FieldName, value: string) => void;
  submit: () => Promise<void>;
  /** 兜底的「重新登录」动作：跳到登录页（幂等，允许连点）。 */
  relogin: () => void;
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
        // D24.1：成功响应一到就跳（服务端此刻已清 cookie 并吊销全部会话）。先落成功态再跳，
        // 导航若被环境拒绝，面板上就是"成功文案 + 重新登录按钮"的兜底态。
        setSuccess(t(ACCOUNT_KEYS.success));
        try {
          redirectToLogin();
        } catch {
          // 导航被环境拒绝（沙箱/异常宿主）：密码已经改完，绝不能把这条异常变成"修改失败"。
          // 停在成功态 + 「重新登录」按钮就好（复审结论）。
        }
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

  return {
    values,
    submitting,
    failure,
    success,
    composing,
    setValue,
    submit,
    relogin: redirectToLogin,
  };
}

/**
 * 改密表单 props：`t` 来自槽位 locale seat。
 * 宿主 owner props 里还有 `close`（关闭设置弹窗），P1.1 起**刻意不再使用**：成功后去向由
 * 服务端会话状态决定（立即去登录页），关掉弹窗只会在死会话 SPA 上留下用户。
 */
export interface AccountPasswordFormProps {
  t: AccountTranslate;
}

/** 已登录时的自助改密表单（成功后立即跳登录页；成功态面板只是兜底）。 */
export function AccountPasswordForm({ t }: AccountPasswordFormProps) {
  const form = usePasswordChange(t);
  const reloginButton = useRef<HTMLButtonElement | null>(null);

  // 兜底态也要可达：跳转被环境拒绝时面板留着，焦点先落到唯一出路（WCAG 2.2.1 不必摸黑找按钮）。
  useEffect(() => {
    if (form.success !== null) reloginButton.current?.focus();
  }, [form.success]);

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
        <h2 style={TITLE_ROW_STYLE}>
          <AccountIcon />
          {t(ACCOUNT_KEYS.title)}
        </h2>
        <p id={ACCOUNT_STATUS_ID} role="status" aria-live="polite" style={SUCCESS_TEXT_STYLE}>
          {form.success}
        </p>
        <button ref={reloginButton} type="button" onClick={form.relogin} style={BUTTON_STYLE}>
          {t(ACCOUNT_KEYS.relogin)}
        </button>
      </section>
    );
  }
  const isInvalid = (field: FieldName): boolean => form.failure?.fields.includes(field) === true;
  return (
    <section style={PANEL_STYLE}>
      <h2 style={TITLE_ROW_STYLE}>
        <AccountIcon />
        {t(ACCOUNT_KEYS.title)}
      </h2>
      <p style={HINT_STYLE}>{t(ACCOUNT_KEYS.intro)}</p>
      <p style={HINT_STYLE}>{t(ACCOUNT_KEYS.scope)}</p>
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
