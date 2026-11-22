/**
 * 通行密钥的添加 / 删除状态机（重设计 2026-11-16）。
 *
 * 与改密同一套纪律：in-flight ref 硬锁（双击只发一次）、请求带 AbortController、
 * 卸载即 abort、回调里再看一眼 mounted，绝不卸载后 setState。
 *
 * 重设计的三处结构变化：
 * 1. **添加值与删除值分开**（`values` / `reauth`）。原来删除读的是添加表单的
 *    `values`，用户要删最后一把钥匙时得先在「添加通行密钥」里输密码（评审 F6）。
 * 2. **待删目标 `pendingRemove`**：点「删除」只设置它，不发请求；确认区展开后
 *    才由 `confirmRemove` 真正提交（评审：破坏性动作不能一次误点就执行）。
 * 3. **反馈互斥**：`failure` 与 `success` 不会同时有值，避免播报位读出矛盾结果。
 */
import { useEffect, useRef, useState } from "react";
import type { AccountTranslate } from "../../../shared/i18n/index.ts";
import { focusFailureTarget } from "../../../shared/ui/index.ts";
import {
  EMPTY_PASSKEY_FORM,
  EMPTY_PASSKEY_REAUTH,
  PASSKEY_STATUS_ID,
  passkeyFieldId,
  passkeyReauthFieldId,
  validatePasskeyForm,
  validatePasskeyReauth,
  type PasskeyFailureView,
  type PasskeyFormValues,
  type PasskeyReauthValues,
} from "./passkey-form.ts";
import { runAdd, runRemove, type ActionContext } from "./passkey-action-runners.ts";

/** 提交控制器：添加值 / 删除值 / 待删目标 / 双锁 / 互斥反馈。 */
export interface PasskeyActions {
  /** 添加表单的值（label / password / code）。 */
  values: PasskeyFormValues;
  /** 删除确认区的再认证值（password / code），与添加值完全独立。 */
  reauth: PasskeyReauthValues;
  invalid: ("label" | "password" | "code")[];
  adding: boolean;
  /** 正在删除的 idPrefix（null = 没有删除在飞）。 */
  removing: string | null;
  /** 已点「删除」但还没确认的目标（null = 没有确认区展开）。 */
  pendingRemove: string | null;
  failure: PasskeyFailureView | null;
  success: string | null;
  setValue: (field: "label" | "password" | "code", value: string) => void;
  setReauthValue: (field: "password" | "code", value: string) => void;
  /** 点某行的「删除」：只展开确认区，不发请求。 */
  requestRemove: (idPrefix: string) => void;
  /** 收起确认区并清空再认证值。 */
  cancelRemove: () => void;
  add: () => Promise<void>;
  confirmRemove: () => Promise<void>;
  clearFeedback: () => void;
}

/** 添加表单的字段顺序（失败后聚焦第一个错误字段用）。 */
const ADD_FIELD_ORDER = ["label", "password", "code"] as const;

/** 删除确认区的字段顺序。 */
const REAUTH_FIELD_ORDER = ["password", "code"] as const;

/** 反馈互斥的依赖。 */
interface FeedbackDeps {
  setFailure: (view: PasskeyFailureView | null) => void;
  setSuccess: (text: string | null) => void;
  setInvalid: (fields: ("label" | "password" | "code")[]) => void;
}

/**
 * 反馈互斥：设失败就清成功，反之亦然。
 *
 * 原来 `failure` 与 `success` 是两个独立布尔，组件契约上允许同时有值，播报位会读出
 * 互相矛盾的结果（评审 F6）。这里把「一次操作只有一个结果」变成结构保证。
 */
function makeFeedback(deps: FeedbackDeps): {
  fail: (view: PasskeyFailureView | null) => void;
  succeed: (text: string | null) => void;
  clearFeedback: () => void;
} {
  return {
    fail: (view) => {
      deps.setFailure(view);
      if (view !== null) deps.setSuccess(null);
    },
    succeed: (text) => {
      deps.setSuccess(text);
      if (text !== null) deps.setFailure(null);
    },
    clearFeedback: () => {
      deps.setFailure(null);
      deps.setSuccess(null);
      deps.setInvalid([]);
    },
  };
}

/** 编辑动作的依赖（把四个 setter 编排起来，避免 hook 主体超 80 行）。 */
interface EditingDeps {
  setValues: (updater: (previous: PasskeyFormValues) => PasskeyFormValues) => void;
  setReauth: (updater: (previous: PasskeyReauthValues) => PasskeyReauthValues) => void;
  setFailure: (view: PasskeyFailureView | null) => void;
  setInvalid: (
    updater: (previous: ("label" | "password" | "code")[]) => ("label" | "password" | "code")[],
  ) => void;
  setPendingRemove: (idPrefix: string | null) => void;
}

/** 编辑阶段的四个动作：改添加值、改再认证值、请求删除、取消删除。 */
function makeEditingActions(deps: EditingDeps): {
  setValue: (field: "label" | "password" | "code", value: string) => void;
  setReauthValue: (field: "password" | "code", value: string) => void;
  requestRemove: (idPrefix: string) => void;
  cancelRemove: () => void;
} {
  /** 编辑即清错：改正后红框不能还在。 */
  const clearField = (field: "label" | "password" | "code"): void => {
    deps.setFailure(null);
    deps.setInvalid((previous) => previous.filter((item) => item !== field));
  };
  return {
    setValue: (field, value) => {
      deps.setValues((previous) => ({ ...previous, [field]: value }));
      clearField(field);
    },
    setReauthValue: (field, value) => {
      deps.setReauth((previous) => ({ ...previous, [field]: value }));
      clearField(field);
    },
    requestRemove: (idPrefix) => {
      // 切换目标时清掉上一份再认证值与错误，避免把 A 的密码用到 B 上。
      deps.setReauth(() => EMPTY_PASSKEY_REAUTH);
      deps.setFailure(null);
      deps.setInvalid(() => []);
      deps.setPendingRemove(idPrefix);
    },
    cancelRemove: () => {
      deps.setPendingRemove(null);
      deps.setReauth(() => EMPTY_PASSKEY_REAUTH);
      deps.setFailure(null);
      deps.setInvalid(() => []);
    },
  };
}

/** 提交动作的依赖。 */
interface SubmitDeps {
  t: AccountTranslate;
  values: PasskeyFormValues;
  reauth: PasskeyReauthValues;
  pendingRemove: string | null;
  context: ActionContext;
  fail: (view: PasskeyFailureView | null) => void;
  setInvalid: (fields: ("label" | "password" | "code")[]) => void;
  setValues: (values: PasskeyFormValues) => void;
  setReauth: (values: PasskeyReauthValues) => void;
  setPendingRemove: (idPrefix: string | null) => void;
}

/**
 * 添加与确认删除：先本地校验（失败聚焦第一个错误字段），再交给 runner 发请求。
 *
 * 抽成独立 hook 是为了让 `usePasskeyActions` 主体留在 80 行以内。
 */
function usePasskeySubmit(deps: SubmitDeps): {
  add: () => Promise<void>;
  confirmRemove: () => Promise<void>;
} {
  const { t, values, reauth, pendingRemove, context, fail, setInvalid } = deps;
  return {
    add: async () => {
      const problem = validatePasskeyForm(values, t);
      if (problem !== null) {
        fail(problem);
        setInvalid(problem.fields);
        focusFailureTarget({
          fields: problem.fields,
          order: ADD_FIELD_ORDER,
          elementId: passkeyFieldId,
          statusId: PASSKEY_STATUS_ID,
        });
        return;
      }
      await runAdd(values, context, { setValues: deps.setValues });
    },
    confirmRemove: async () => {
      if (pendingRemove === null) return;
      const problem = validatePasskeyReauth(reauth, t);
      if (problem !== null) {
        fail(problem);
        setInvalid(problem.fields);
        focusFailureTarget({
          fields: problem.fields,
          order: REAUTH_FIELD_ORDER,
          elementId: passkeyReauthFieldId,
          statusId: PASSKEY_STATUS_ID,
        });
        return;
      }
      await runRemove(pendingRemove, reauth, context, {
        clearReauth: () => {
          deps.setReauth(EMPTY_PASSKEY_REAUTH);
          deps.setPendingRemove(null);
        },
      });
    },
  };
}

/**
 * 添加/删除的提交状态机。`onChanged` 在成功后调用（父组件用它刷新列表）。
 * 用户取消系统验证器（AbortError/NotAllowedError）静默回退：不显示错误、恢复按钮。
 */
export function usePasskeyActions(t: AccountTranslate, onChanged: () => void): PasskeyActions {
  const [values, setValues] = useState<PasskeyFormValues>(EMPTY_PASSKEY_FORM);
  const [reauth, setReauth] = useState<PasskeyReauthValues>(EMPTY_PASSKEY_REAUTH);
  const [invalid, setInvalid] = useState<("label" | "password" | "code")[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
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

  const feedback = makeFeedback({ setFailure, setSuccess, setInvalid });

  const context: ActionContext = {
    t,
    lock,
    abort,
    mounted,
    setAdding,
    setRemoving,
    setFailure: feedback.fail,
    setInvalid,
    setSuccess: feedback.succeed,
    clearFeedback: feedback.clearFeedback,
    onChanged,
  };

  const editing = makeEditingActions({
    setValues,
    setReauth,
    setFailure,
    setInvalid,
    setPendingRemove,
  });

  const submit = usePasskeySubmit({
    t,
    values,
    reauth,
    pendingRemove,
    context,
    fail: feedback.fail,
    setInvalid,
    setValues,
    setReauth,
    setPendingRemove,
  });

  return {
    values,
    reauth,
    invalid,
    adding,
    removing,
    pendingRemove,
    failure,
    success,
    setValue: editing.setValue,
    setReauthValue: editing.setReauthValue,
    requestRemove: editing.requestRemove,
    cancelRemove: editing.cancelRemove,
    add: submit.add,
    confirmRemove: submit.confirmRemove,
    clearFeedback: feedback.clearFeedback,
  };
}
