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
import { type AdminTranslate } from "../lib/admin-copy.ts";
import { type AdminFailureView, type AdminField, type AdminResetValues } from "./admin-reset.ts";
import type { AdminSuccessView } from "../ui/admin-fields.tsx";
import type { AdminResetStage } from "./use-admin-reset.ts";
/** 失败落点：有字段错误聚焦第一个，否则聚焦状态位。 */
export declare function focusFailure(view: AdminFailureView): void;
/** 成功视图（A8）：`sessionsRevoked:false` 是安全失败，文案与样式都换一套。 */
export declare function successView(sessionsRevoked: boolean, t: AdminTranslate): AdminSuccessView;
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
export declare function useResetEditing(deps: ResetEditingDeps): {
    setValue: (field: AdminField, value: string) => void;
    review: () => void;
    back: () => void;
    cancel: () => void;
};
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
export declare function useResetSubmit(deps: ResetSubmitDeps): () => Promise<void>;
/** 表单事件处理：Enter 只在编辑阶段推进到确认页，确认阶段不触发危险动作。 */
export declare function useFormHandlers({ composing, stage, review, }: {
    composing: MutableRefObject<boolean>;
    stage: AdminResetStage;
    review: () => void;
}): {
    onSubmit: (event: {
        preventDefault: () => void;
    }) => void;
    onKeyDown: (event: {
        key: string;
        target: EventTarget | null;
        preventDefault: () => void;
        nativeEvent: {
            isComposing?: boolean;
        };
    }) => void;
};
export {};
//# sourceMappingURL=admin-reset-hooks.d.ts.map