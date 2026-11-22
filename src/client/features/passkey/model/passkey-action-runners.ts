/**
 * 添加 / 删除的提交 runner（重设计 2026-11-16 从 `use-passkey-actions.ts` 拆出）。
 *
 * 拆出来的原因：那个 hook 已经 240 行，再加「独立删除值 + 待删目标 + 互斥反馈」会撞
 * 250 行红线。这里只放两个纯异步函数，状态由调用方持有。
 *
 * 纪律与改密一致：in-flight ref 硬锁（双击只发一次）、请求带 AbortController、
 * 卸载即 abort、回调里再看一眼 mounted，绝不卸载后 setState。
 */
import type { AccountTranslate } from "../../../shared/i18n/index.ts";
import { PASSKEY_KEYS } from "../../../shared/i18n/index.ts";
import { registerPasskey, removePasskey } from "../api/passkey-mutate.ts";
import type { PasskeyFailureView, PasskeyFormValues, PasskeyReauthValues } from "./passkey-form.ts";

/** 提交状态机共享的上下文（把 80 行上限留给两个 runner，而不是一个巨型 hook）。 */
export interface ActionContext {
  t: AccountTranslate;
  lock: { current: boolean };
  abort: { current: AbortController | null };
  mounted: { current: boolean };
  setAdding: (value: boolean) => void;
  setRemoving: (value: string | null) => void;
  setFailure: (value: PasskeyFailureView | null) => void;
  setInvalid: (value: ("label" | "password" | "code")[]) => void;
  setSuccess: (value: string | null) => void;
  clearFeedback: () => void;
  onChanged: () => void;
}

/** 添加成功后的收尾：清表单、播报、刷新列表。 */
export interface AddCallbacks {
  setValues: (values: PasskeyFormValues) => void;
}

/** 删除成功后的收尾：清再认证值、播报、刷新列表。 */
export interface RemoveCallbacks {
  clearReauth: () => void;
}

/** 添加：本地校验已在调用方做过，这里只负责请求与结果落 UI。 */
export async function runAdd(
  values: PasskeyFormValues,
  context: ActionContext,
  callbacks: AddCallbacks,
): Promise<void> {
  const { t, lock, abort, mounted, setAdding, setFailure, setInvalid, setSuccess } = context;
  // 另一个动作在飞：明确告知「等一下」，不静默丢弃这次点击（C6）。
  if (lock.current) {
    setFailure({ message: t(PASSKEY_KEYS.busy), fields: [] });
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
    if (result.kind === "ok") {
      callbacks.setValues({ label: "", password: "", code: "" });
      setSuccess(t(PASSKEY_KEYS.successAdd));
      context.onChanged();
      return;
    }
    if (result.kind === "unsupported") {
      setFailure({ message: t(PASSKEY_KEYS.unsupported), fields: [] });
      return;
    }
    if (result.kind === "failure") {
      setFailure({ message: result.message, fields: result.fields });
      setInvalid(result.fields);
    }
  } catch {
    if (mounted.current && !controller.signal.aborted) {
      setFailure({ message: t(PASSKEY_KEYS.generic), fields: [] });
    }
  } finally {
    lock.current = false;
    if (mounted.current) setAdding(false);
  }
}

/** 删除：调用方已确认目标并校验过再认证值，这里只负责请求与结果落 UI。 */
export async function runRemove(
  idPrefix: string,
  values: PasskeyReauthValues,
  context: ActionContext,
  callbacks: RemoveCallbacks,
): Promise<void> {
  const { t, lock, abort, mounted, setRemoving, setFailure, setInvalid, setSuccess } = context;
  if (lock.current) {
    setFailure({ message: t(PASSKEY_KEYS.busy), fields: [] });
    return;
  }
  lock.current = true;
  setRemoving(idPrefix);
  context.clearFeedback();
  const controller = new AbortController();
  abort.current = controller;
  try {
    const result = await removePasskey(idPrefix, values, controller.signal, t);
    if (!mounted.current || controller.signal.aborted) return;
    if (result.kind === "ok") {
      callbacks.clearReauth();
      setSuccess(t(PASSKEY_KEYS.successRemove));
      context.onChanged();
      return;
    }
    if (result.kind === "failure") {
      setFailure(result.failure);
      setInvalid(result.failure.fields);
    }
  } catch {
    if (mounted.current && !controller.signal.aborted) {
      setFailure({ message: t(PASSKEY_KEYS.generic), fields: [] });
    }
  } finally {
    lock.current = false;
    if (mounted.current) setRemoving(null);
  }
}
