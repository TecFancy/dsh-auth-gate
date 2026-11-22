import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { ACCOUNT_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ActionButton,
  focusFailureTarget,
  FORM_STYLE,
  PANEL_STYLE,
  SUCCESS_TEXT_STYLE,
} from "../../../shared/ui/index.ts";
import { redirectToLogin, redirectToSignIn } from "../lib/account-redirect.ts";
import { ACCOUNT_STATUS_ID, PasswordFields, StatusLine } from "./account-fields.tsx";
import { AccountHeader } from "./account-header.tsx";
import {
  EMPTY_VALUES,
  submitPassword,
  validate,
  type FailureView,
  type FieldName,
  type FormValues,
} from "../model/account-submit.ts";

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
  /** 会话失效（401 unauthorized）后的重新登录：登录页，不带改密 notice。 */
  signIn: () => void;
}

/** 字段的文档顺序：失败后按这个顺序找第一个错误字段聚焦。 */
const FIELD_ORDER: FieldName[] = ["current", "password", "confirm", "code"];

/** 字段 id（与 account-fields.tsx 的 `fieldId` 同形；聚焦要用）。 */
function fieldElementId(field: FieldName): string {
  return `dsh-auth-gate-account-${field}`;
}

/**
 * 表单状态机：
 * - 双锁 = in-flight ref（硬锁，Enter/点击并发都挡）+ submitting 按钮 disabled（可见锁）；
 * - IME 组合期由 composing ref 挡住，避免中文输入法确认键提交；
 * - 请求带 AbortController，卸载即 abort，回调再看 mounted，绝不卸载后 setState；
 * - 编辑任一字段清掉上一轮错误（重设计：原来改正后红框还在）；
 * - 失败后把焦点落到第一个错误字段，无字段错误落到状态位。
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

  /** 失败落点：有字段错误聚焦第一个，否则聚焦状态位（tabIndex=-1）。 */
  const focusFailure = (view: FailureView): void => {
    focusFailureTarget({
      fields: view.fields,
      order: FIELD_ORDER,
      elementId: fieldElementId,
      statusId: ACCOUNT_STATUS_ID,
    });
  };

  const setValue = (field: FieldName, value: string): void => {
    setValues((previous) => ({ ...previous, [field]: value }));
    // 编辑即清错：过时的红框和「密码不一致」不能继续成立。
    setFailure(null);
  };

  const submit = async (): Promise<void> => {
    if (lock.current) return;
    const invalid = validate(values, t);
    if (invalid !== null) {
      setFailure(invalid);
      focusFailure(invalid);
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
      if (result.kind === "failure") {
        setFailure(result.failure);
        focusFailure(result.failure);
      }
    } catch {
      if (!live()) return;
      const generic: FailureView = { message: t(ACCOUNT_KEYS.generic), rules: [], fields: [] };
      setFailure(generic);
      focusFailure(generic);
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
    signIn: redirectToSignIn,
  };
}

/**
 * 改密表单 props：`t` 来自槽位 locale seat。
 * 宿主 owner props 里还有 `close`（关闭设置弹窗），P1.1 起**刻意不再使用**：成功后去向由
 * 服务端会话状态决定（立即去登录页），关掉弹窗只会在死会话 SPA 上留下用户。
 */
export interface AccountPasswordFormProps {
  t: AccountTranslate;
  /**
   * 当前账号是否开启两步验证：只影响动态码框的提示文案。
   * `undefined` = 旧服务端没给这个字段，沿用保守文案。
   */
  totpEnabled?: boolean | undefined;
}

/** 已登录时的自助改密表单（成功后立即跳登录页；成功态面板只是兜底）。 */
export function AccountPasswordForm({ t, totpEnabled }: AccountPasswordFormProps) {
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
        <AccountHeader t={t} showIntro={false} />
        <p id={ACCOUNT_STATUS_ID} role="status" aria-live="polite" style={SUCCESS_TEXT_STYLE}>
          {form.success}
        </p>
        <ActionButton ref={reloginButton} onClick={form.relogin}>
          {t(ACCOUNT_KEYS.relogin)}
        </ActionButton>
      </section>
    );
  }
  const isInvalid = (field: FieldName): boolean => form.failure?.fields.includes(field) === true;
  return (
    <section style={PANEL_STYLE}>
      <AccountHeader t={t} />
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
        <PasswordFields
          t={t}
          values={form.values}
          isInvalid={isInvalid}
          onChange={form.setValue}
          readOnly={form.submitting}
          totpEnabled={totpEnabled}
        />
        <StatusLine failure={form.failure} />
        {form.failure?.relogin === true ? (
          <ActionButton variant="ghost" onClick={() => form.signIn()}>
            {t(ACCOUNT_KEYS.relogin)}
          </ActionButton>
        ) : null}
        <ActionButton type="submit" busy={form.submitting}>
          {form.submitting ? t(ACCOUNT_KEYS.submitting) : t(ACCOUNT_KEYS.submit)}
        </ActionButton>
      </form>
    </section>
  );
}
