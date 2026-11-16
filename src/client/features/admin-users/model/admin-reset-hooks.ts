/**
 * 重置他人密码的三个内部 hook（重设计 2026-11-16）。
 *
 * 从 `use-admin-reset.ts` 拆出来的原因：那个文件加上确认阶段后超过 250 行红线。
 * 三个 hook 各自只做一件事，都不持有状态，只把调用方的 setter 编排起来：
 *
 * - `useResetEditing`：改值 / 检查（进确认页）/ 返回修改 / 取消并清空；
 * - `useResetSubmit`：确认页的显式确认，真正发请求（双锁 + abort + mounted）；
 * - `useFormHandlers`：Enter 只在编辑阶段推进，确认阶段不触发危险动作。
 */
import type { MutableRefObject } from "react";
import { submitAdminReset, validateAdminReset } from "../api/admin-api.ts";
import { ADMIN_KEYS, type AdminTranslate } from "../lib/admin-copy.ts";
import {
  EMPTY_ADMIN_RESET,
  type AdminFailureView,
  type AdminField,
  type AdminResetValues,
} from "./admin-reset.ts";
import type { AdminSuccessView } from "../ui/admin-fields.tsx";
import type { AdminResetStage } from "./use-admin-reset.ts";

/** 字段的文档顺序：失败后按这个顺序找第一个错误字段聚焦。 */
const FIELD_ORDER: AdminField[] = ["target", "password", "confirm", "code"];

/** 状态播报位 id。 */
const STATUS_ID = "dsh-auth-gate-admin-status";

/** 字段 id（与 admin-fields.tsx 的 `adminFieldId` 同形；聚焦要用）。 */
function fieldElementId(field: AdminField): string {
  return `dsh-auth-gate-admin-${field}`;
}

/** 失败落点：有字段错误聚焦第一个，否则聚焦状态位。 */
export function focusFailure(view: AdminFailureView): void {
  const first = FIELD_ORDER.find((field) => view.fields.includes(field));
  const target =
    first === undefined
      ? document.getElementById(STATUS_ID)
      : document.getElementById(fieldElementId(first));
  target?.focus();
}

/** 成功视图（A8）：`sessionsRevoked:false` 是安全失败，文案与样式都换一套。 */
export function successView(sessionsRevoked: boolean, t: AdminTranslate): AdminSuccessView {
  return sessionsRevoked
    ? { text: t(ADMIN_KEYS.successRevoked), warning: false }
    : { text: t(ADMIN_KEYS.successKept), warning: true };
}

/** 请求结果：成功（含会话吊销是否成功）/ 失败视图。 */
type ResetOutcome =
  { kind: "ok"; sessionsRevoked: boolean } | { kind: "failure"; failure: AdminFailureView };

/**
 * 发一次重置请求并把结果归一成 `ResetOutcome`。
 *
 * 异常也在这里收口成 generic 失败，调用方不需要再写 try/catch。
 */
async function runReset(
  values: AdminResetValues,
  signal: AbortSignal,
  options: { t: AdminTranslate; actorTotpEnabled: boolean },
): Promise<ResetOutcome> {
  try {
    const result = await submitAdminReset(
      values,
      { signal, actorTotpEnabled: options.actorTotpEnabled },
      options.t,
    );
    if (result.kind === "ok") return { kind: "ok", sessionsRevoked: result.sessionsRevoked };
    if (result.kind === "aborted") {
      return {
        kind: "failure",
        failure: { message: options.t(ADMIN_KEYS.generic), rules: [], fields: [] },
      };
    }
    return { kind: "failure", failure: result.failure };
  } catch {
    return {
      kind: "failure",
      failure: { message: options.t(ADMIN_KEYS.generic), rules: [], fields: [] },
    };
  }
}

/** 编辑阶段动作的依赖。 */
interface ResetEditingDeps {
  values: AdminResetValues;
  t: AdminTranslate;
  actorTotpEnabled: boolean;
  lock: MutableRefObject<boolean>;
  setValues: (values: AdminResetValues) => void;
  setStage: (stage: AdminResetStage) => void;
  setFailure: (view: AdminFailureView | null) => void;
  setSuccess: (view: AdminSuccessView | null) => void;
}

/**
 * 编辑阶段的四个动作：改值、检查（进确认页）、返回修改、取消并清空。
 *
 * 抽成独立 hook 是为了让 `useAdminReset` 主体留在 80 行以内；这里不持有状态，
 * 只把调用方的 setter 编排起来。
 */
export function useResetEditing(deps: ResetEditingDeps): {
  setValue: (field: AdminField, value: string) => void;
  review: () => void;
  back: () => void;
  cancel: () => void;
} {
  const { values, t, actorTotpEnabled, lock } = deps;
  return {
    setValue: (field, value) => {
      deps.setValues({ ...values, [field]: value });
      // 编辑即清错：改正后红框不能还在。
      deps.setFailure(null);
    },
    /** 第一次提交：只校验 + 进确认页，绝不发请求。 */
    review: () => {
      if (lock.current) return;
      const invalid = validateAdminReset(values, t, actorTotpEnabled);
      if (invalid !== null) {
        deps.setFailure(invalid);
        focusFailure(invalid);
        return;
      }
      deps.setFailure(null);
      deps.setSuccess(null);
      deps.setStage("confirm");
    },
    back: () => {
      deps.setStage("editing");
      deps.setFailure(null);
    },
    cancel: () => {
      deps.setValues({ ...EMPTY_ADMIN_RESET });
      deps.setStage("editing");
      deps.setFailure(null);
      deps.setSuccess(null);
    },
  };
}

/** 提交编排的依赖（把 confirm 从 hook 主体里挪出来，避免函数超 80 行）。 */
interface ResetSubmitDeps {
  values: AdminResetValues;
  t: AdminTranslate;
  actorTotpEnabled: boolean;
  lock: MutableRefObject<boolean>;
  abort: MutableRefObject<AbortController | null>;
  mounted: MutableRefObject<boolean>;
  setStage: (stage: AdminResetStage) => void;
  setFailure: (view: AdminFailureView | null) => void;
  setSuccess: (view: AdminSuccessView | null) => void;
  setValues: (values: AdminResetValues) => void;
  onReset?: (() => void) | undefined;
}

/**
 * 确认页的显式确认：这里才真正发请求。
 *
 * 双锁（`lock`）+ abort + mounted 三重保护与改密/通行密钥同一套纪律。
 */
export function useResetSubmit(deps: ResetSubmitDeps): () => Promise<void> {
  const { values, t, actorTotpEnabled, lock, abort, mounted } = deps;
  return async (): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    deps.setStage("submitting");
    deps.setFailure(null);
    deps.setSuccess(null);
    const controller = new AbortController();
    abort.current = controller;
    const live = (): boolean => mounted.current && !controller.signal.aborted;
    try {
      const outcome = await runReset(values, controller.signal, { t, actorTotpEnabled });
      if (!live()) return;
      if (outcome.kind === "ok") {
        deps.setSuccess(successView(outcome.sessionsRevoked, t));
        deps.setValues({ ...EMPTY_ADMIN_RESET });
        deps.onReset?.(); // A7：成功后重拉列表刷新徽标；失败路径不动行
        return;
      }
      deps.setFailure(outcome.failure);
      focusFailure(outcome.failure);
    } finally {
      lock.current = false;
      if (mounted.current) deps.setStage("editing");
    }
  };
}

/** 表单事件处理：Enter 只在编辑阶段推进到确认页，确认阶段不触发危险动作。 */
export function useFormHandlers({
  composing,
  stage,
  review,
}: {
  composing: MutableRefObject<boolean>;
  stage: AdminResetStage;
  review: () => void;
}): {
  onSubmit: (event: { preventDefault: () => void }) => void;
  onKeyDown: (event: {
    key: string;
    target: EventTarget | null;
    preventDefault: () => void;
    nativeEvent: { isComposing?: boolean };
  }) => void;
} {
  return {
    onSubmit: (event) => {
      event.preventDefault();
      if (composing.current) return;
      if (stage === "editing") review();
    },
    onKeyDown: (event) => {
      if (event.key !== "Enter") return;
      // 焦点在下拉里时 Enter 是"确认选项"：既不 preventDefault 也不提交（grok 回顾 #5）。
      if (event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      if (composing.current || event.nativeEvent.isComposing === true) return;
      if (stage === "editing") review();
    },
  };
}
