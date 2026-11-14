/**
 * passkey 添加/删除的提交状态机（M6 PR3）。
 *
 * 与 `change-password` 同一套纪律：in-flight ref 硬锁（双击只发一次）、请求带
 * AbortController、卸载即 abort、回调里再看一眼 mounted，绝不卸载后 setState。
 */
import { useEffect, useRef, useState } from "react";
import type { AccountTranslate } from "../../../shared/i18n/index.ts";
import { PASSKEY_KEYS } from "../../../shared/i18n/index.ts";
import { registerPasskey, removePasskey } from "../api/passkey-mutate.ts";
import {
  EMPTY_PASSKEY_FORM,
  validatePasskeyForm,
  type PasskeyFailureView,
  type PasskeyFormValues,
} from "./passkey-form.ts";

/** 提交控制器：表单值 + 双锁 + 失败/成功反馈 + 正在删除的 idPrefix。 */
export interface PasskeyActions {
  values: PasskeyFormValues;
  invalid: ("label" | "password" | "code")[];
  adding: boolean;
  removing: string | null;
  failure: PasskeyFailureView | null;
  success: string | null;
  setValue: (field: "label" | "password" | "code", value: string) => void;
  add: () => Promise<void>;
  remove: (idPrefix: string) => Promise<void>;
  clearFeedback: () => void;
}

/** 添加结果 → UI 状态（成功清空表单并刷新列表；失败标红字段）。 */
function applyAddResult(
  result: Awaited<ReturnType<typeof registerPasskey>>,
  ui: ActionContext,
): void {
  if (result.kind === "ok") {
    ui.setValues(EMPTY_PASSKEY_FORM);
    ui.setSuccess(ui.t(PASSKEY_KEYS.successAdd));
    ui.onChanged();
    return;
  }
  if (result.kind === "unsupported") {
    ui.setFailure({ message: ui.t(PASSKEY_KEYS.unsupported), fields: [] });
    return;
  }
  if (result.kind === "failure") {
    ui.setFailure({ message: result.message, fields: result.fields });
    ui.setInvalid(result.fields);
  }
}

/** 删除结果 → UI 状态（成功刷新列表；失败标红字段）。 */
function applyRemoveResult(
  result: Awaited<ReturnType<typeof removePasskey>>,
  ui: ActionContext,
): void {
  if (result.kind === "ok") {
    ui.setSuccess(ui.t(PASSKEY_KEYS.successRemove));
    ui.onChanged();
    return;
  }
  if (result.kind === "failure") {
    ui.setFailure(result.failure);
    ui.setInvalid(result.failure.fields);
  }
}

/** 提交状态机共享的上下文（把 80 行上限留给两个 runner，而不是一个巨型 hook）。 */
interface ActionContext {
  values: PasskeyFormValues;
  t: AccountTranslate;
  lock: { current: boolean };
  abort: { current: AbortController | null };
  mounted: { current: boolean };
  setValues: (values: PasskeyFormValues) => void;
  setAdding: (value: boolean) => void;
  setRemoving: (value: string | null) => void;
  setFailure: (value: PasskeyFailureView | null) => void;
  setInvalid: (value: ("label" | "password" | "code")[]) => void;
  setSuccess: (value: string | null) => void;
  clearFeedback: () => void;
  onChanged: () => void;
}

/** 添加：本地校验 → 双锁 → 注册 → 结果落 UI。 */
async function runAdd(context: ActionContext): Promise<void> {
  const { values, t, lock, abort, mounted, setAdding, setFailure, setInvalid, setSuccess } =
    context;
  if (lock.current) return;
  const problem = validatePasskeyForm(values, t);
  if (problem !== null) {
    setFailure(problem);
    setInvalid(problem.fields);
    setSuccess(null);
    return;
  }
  lock.current = true;
  setAdding(true);
  context.clearFeedback();
  const controller = new AbortController();
  abort.current = controller;
  try {
    const result = await registerPasskey(values, controller.signal, t);
    if (!mounted.current || controller.signal.aborted) return;
    applyAddResult(result, context);
  } catch {
    if (mounted.current && !controller.signal.aborted) {
      setFailure({ message: t(PASSKEY_KEYS.generic), fields: [] });
    }
  } finally {
    lock.current = false;
    if (mounted.current) setAdding(false);
  }
}

/** 删除：双锁 → 删除 → 结果落 UI。 */
async function runRemove(idPrefix: string, context: ActionContext): Promise<void> {
  const { values, t, lock, abort, mounted, setRemoving, setFailure } = context;
  if (lock.current) return;
  lock.current = true;
  setRemoving(idPrefix);
  context.clearFeedback();
  const controller = new AbortController();
  abort.current = controller;
  try {
    const result = await removePasskey(idPrefix, values, controller.signal, t);
    if (!mounted.current || controller.signal.aborted) return;
    applyRemoveResult(result, context);
  } catch {
    if (mounted.current && !controller.signal.aborted) {
      setFailure({ message: t(PASSKEY_KEYS.generic), fields: [] });
    }
  } finally {
    lock.current = false;
    if (mounted.current) setRemoving(null);
  }
}

/**
 * 添加/删除的提交状态机。`onChanged` 在成功后调用（父组件用它刷新列表）。
 * 用户取消（AbortError/NotAllowedError）静默回退：不显示错误、恢复按钮。
 */
export function usePasskeyActions(t: AccountTranslate, onChanged: () => void): PasskeyActions {
  const [values, setValues] = useState<PasskeyFormValues>(EMPTY_PASSKEY_FORM);
  const [invalid, setInvalid] = useState<("label" | "password" | "code")[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<PasskeyFailureView | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const setValue = (field: "label" | "password" | "code", value: string): void => {
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  const clearFeedback = (): void => {
    setFailure(null);
    setSuccess(null);
    setInvalid([]);
  };

  const add = (): Promise<void> =>
    runAdd({
      values,
      t,
      lock,
      abort,
      mounted,
      setValues,
      setAdding,
      setRemoving,
      setFailure,
      setInvalid,
      setSuccess,
      clearFeedback,
      onChanged,
    });

  const remove = (idPrefix: string): Promise<void> =>
    runRemove(idPrefix, {
      values,
      t,
      lock,
      abort,
      mounted,
      setValues,
      setAdding,
      setRemoving,
      setFailure,
      setInvalid,
      setSuccess,
      clearFeedback,
      onChanged,
    });

  return {
    values,
    invalid,
    adding,
    removing,
    failure,
    success,
    setValue,
    add,
    remove,
    clearFeedback,
  };
}
