import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { submitAdminReset, validateAdminReset } from "./admin-api.ts";
import { ADMIN_KEYS, type AdminTranslate } from "./admin-copy.ts";
import {
  AdminStatus,
  AdminTextField,
  ADMIN_CODE_HINT_ID,
  ADMIN_STATUS_ID,
  adminFieldId,
  type AdminSuccessView,
} from "./admin-fields.tsx";
import {
  EMPTY_ADMIN_RESET,
  type AdminFailureView,
  type AdminField,
  type AdminResetValues,
  type AdminUserRow,
} from "./admin-types.ts";
import {
  BUTTON_BUSY_STYLE,
  BUTTON_STYLE,
  FORM_STYLE,
  HINT_STYLE,
  INPUT_STYLE,
  INVALID_INPUT_STYLE,
  LABEL_STYLE,
} from "./account-styles.ts";

/**
 * 表单状态机（与自助面同范式）：
 * - 双锁 = in-flight ref（硬锁，Enter/点击并发都挡）+ submitting 按钮 disabled（可见锁）；
 * - IME 组合期由 composing ref 挡住，避免中文输入法确认键提交；
 * - 请求带 AbortController，卸载即 abort，回调再看 mounted，绝不卸载后 setState；
 * - 成功：落成功文案（`sessionsRevoked:false` 走 A8 的安全失败样式），清空四字段，再重拉列表。
 */
/** 表单事件：IME 组合期（Enter 确认键）一律不提交；并发双锁由 `submit` 自己兜底。 */
function formHandlers(
  composing: MutableRefObject<boolean>,
  submit: () => Promise<void>,
): {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
} {
  return {
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onSubmit: (event) => {
      event.preventDefault();
      if (composing.current) return;
      void submit();
    },
    onKeyDown: (event) => {
      if (event.key !== "Enter") return;
      // 焦点在下拉里时 Enter 是"确认选项"：既不 preventDefault 也不提交（grok 回顾 #5）。
      if (event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      if (composing.current || event.nativeEvent.isComposing) return;
      void submit();
    },
  };
}

/** 成功视图（A8）：`sessionsRevoked:false` 是安全失败，文案与样式都换一套。 */
function successView(sessionsRevoked: boolean, t: AdminTranslate): AdminSuccessView {
  return sessionsRevoked
    ? { text: t(ADMIN_KEYS.successRevoked), warning: false }
    : { text: t(ADMIN_KEYS.successKept), warning: true };
}

function useAdminReset(
  t: AdminTranslate,
  actorTotpEnabled: boolean,
  onReset: (() => void) | undefined,
) {
  const [values, setValues] = useState<AdminResetValues>(EMPTY_ADMIN_RESET);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AdminFailureView | null>(null);
  const [success, setSuccess] = useState<AdminSuccessView | null>(null);
  const lock = useRef(false);
  const composing = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    // StrictMode 双挂载：effect 会「跑 → 清理 → 再跑」，所以挂载时必须**重新置 true**
    // （只写清理会把 mounted 永久钉在 false → 提交结果全丢、按钮卡在"提交中"）。
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const setValue = (field: AdminField, value: string): void => {
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  const submit = async (): Promise<void> => {
    if (lock.current) return;
    const invalid = validateAdminReset(values, t, actorTotpEnabled);
    if (invalid !== null) {
      setFailure(invalid);
      return;
    }
    lock.current = true;
    setSubmitting(true);
    setFailure(null);
    setSuccess(null);
    const controller = new AbortController();
    abort.current = controller;
    const live = (): boolean => mounted.current && !controller.signal.aborted;
    try {
      const result = await submitAdminReset(
        values,
        { signal: controller.signal, actorTotpEnabled },
        t,
      );
      if (!live()) return;
      if (result.kind === "ok") {
        setSuccess(successView(result.sessionsRevoked, t));
        setValues({ ...EMPTY_ADMIN_RESET });
        onReset?.(); // A7：成功后重拉列表刷新徽标；失败路径不动行
        return;
      }
      if (result.kind === "failure") setFailure(result.failure);
    } catch {
      if (!live()) return;
      setFailure({ message: t(ADMIN_KEYS.generic), rules: [], fields: [] });
    } finally {
      lock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const handlers = formHandlers(composing, submit);
  return { values, submitting, failure, success, setValue, ...handlers };
}

export interface AdminResetFormProps {
  t: AdminTranslate;
  users: AdminUserRow[];
  actorName: string;
  actorTotpEnabled: boolean;
  /** A7：成功回调（管理块用它重拉列表刷新徽标）；失败路径不调用。 */
  onReset?: (() => void) | undefined;
}

/** 管理重置表单：目标下拉（排除本人）+ 新口令 ×2 + 条件式动态码；成功后清空四字段、不跳转。 */
export function AdminResetForm({
  t,
  users,
  actorName,
  actorTotpEnabled,
  onReset,
}: AdminResetFormProps) {
  const form = useAdminReset(t, actorTotpEnabled, onReset);
  const targets = users.filter((user) => user.name !== actorName);
  const fields: { field: AdminField; label: string }[] = [
    { field: "password", label: t(ADMIN_KEYS.password) },
    { field: "confirm", label: t(ADMIN_KEYS.confirm) },
    ...(actorTotpEnabled ? [{ field: "code" as AdminField, label: t(ADMIN_KEYS.code) }] : []),
  ];
  const isInvalid = (field: AdminField): boolean => form.failure?.fields.includes(field) === true;
  const targetInvalid = isInvalid("target");
  return (
    <form
      style={FORM_STYLE}
      noValidate
      aria-busy={form.submitting}
      onSubmit={form.onSubmit}
      onKeyDown={form.onKeyDown}
      onCompositionStart={form.onCompositionStart}
      onCompositionEnd={form.onCompositionEnd}
    >
      <p style={HINT_STYLE}>{t(ADMIN_KEYS.selfHint)}</p>
      <div style={LABEL_STYLE}>
        <label htmlFor={adminFieldId("target")}>{t(ADMIN_KEYS.target)}</label>
        <select
          id={adminFieldId("target")}
          name="target"
          value={form.values.target}
          aria-invalid={targetInvalid ? "true" : undefined}
          aria-describedby={targetInvalid ? ADMIN_STATUS_ID : undefined}
          style={targetInvalid ? INVALID_INPUT_STYLE : INPUT_STYLE}
          onChange={(event) => form.setValue("target", event.target.value)}
        >
          <option value="">{t(ADMIN_KEYS.targetPlaceholder)}</option>
          {targets.map((user) => (
            <option key={user.name} value={user.name}>
              {user.name}
            </option>
          ))}
        </select>
      </div>
      {fields.map((item) => (
        <AdminTextField
          key={item.field}
          field={item.field}
          label={item.label}
          value={form.values[item.field]}
          invalid={isInvalid(item.field)}
          hint={item.field === "code" ? t(ADMIN_KEYS.codeHint) : undefined}
          hintId={item.field === "code" ? ADMIN_CODE_HINT_ID : undefined}
          onChange={(value) => form.setValue(item.field, value)}
        />
      ))}
      <p style={HINT_STYLE}>{t(ADMIN_KEYS.policyHint)}</p>
      <AdminStatus failure={form.failure} success={form.success} />
      <button
        type="submit"
        disabled={form.submitting}
        style={form.submitting ? BUTTON_BUSY_STYLE : BUTTON_STYLE}
      >
        {form.submitting ? t(ADMIN_KEYS.submitting) : t(ADMIN_KEYS.submit)}
      </button>
    </form>
  );
}
