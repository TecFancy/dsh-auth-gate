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
import { redirectToLoginNow, scheduleRedirectToLogin } from "./account-redirect.ts";
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
 * 为什么画在这里而不是导航行：宿主 `settings.section` 只投影 `id`/`order`/`label`，导航
 * 图标由宿主 `navIcon(id)` 的硬编码 if 链给出（第三方段一律齿轮）；插件侧没有官方挂载点，
 * 去改宿主 React 树里的 nav 是"抢 DOM"，评审结论是砍掉。图标画在我们自己的内容区：
 * 可测、可卸载、零宿主耦合。路径数据与 `docs/demo/account-security.svg` 同源。
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
  /** 成功态的「重新登录」动作：清掉待跳定时器后立即 replace（幂等，允许连点）。 */
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

  /**
   * P1.1 / D24：改密成功后**不再**留在面板上（服务端此刻已清 cookie 并吊销全部会话，
   * 停在这里等于停在一个所有请求都 401 的死会话 SPA 上）→ 约定时间后回登录页。
   *
   * 定时器归 `account-redirect.ts` 的模块作用域管，**这里刻意不写 cleanup**：成功态会被宿主
   * 关弹窗 / 切分区 / status 翻转拆掉，卸载即取消跳转的话，人反而被留在死会话壳里（复审结论）。
   */
  useEffect(() => {
    if (success === null) return;
    scheduleRedirectToLogin();
  }, [success]);

  return {
    values,
    submitting,
    failure,
    success,
    composing,
    setValue,
    submit,
    relogin: redirectToLoginNow,
  };
}

/**
 * 改密表单 props：`t` 来自槽位 locale seat。
 * 宿主 owner props 里还有 `close`（关闭设置弹窗），P1.1 起**刻意不再使用**：成功后去向由
 * 服务端会话状态决定（去登录页），关掉弹窗只会在死会话 SPA 上留下用户。
 */
export interface AccountPasswordFormProps {
  t: AccountTranslate;
}

/** 已登录时的自助改密表单（成功后整页换成提示 + 「重新登录」按钮）。 */
export function AccountPasswordForm({ t }: AccountPasswordFormProps) {
  const form = usePasswordChange(t);
  const reloginButton = useRef<HTMLButtonElement | null>(null);

  // 成功态不再是"关掉就好"：把焦点交给「重新登录」，键盘/读屏用户不必等 2.5s 自动跳。
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
