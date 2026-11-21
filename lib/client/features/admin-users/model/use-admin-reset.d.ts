/**
 * 重置他人密码的状态机（重设计 2026-11-16 从 `admin-form.tsx` 拆出）。
 *
 * 拆出来的原因：`admin-form.tsx` 已经 231 行，再加「确认阶段」会撞 250 行红线。
 *
 * 重设计的核心变化是**两阶段提交**：第一次提交只做本地校验并进入确认页，不发请求；
 * 用户在确认页看到「确认重置 {name} 的密码？」和不可逆后果，显式点确认才真正发请求。
 * 原来选错用户名直接执行，旧密码立即失效 + 会话吊销，是管理面最贵的可预防错误。
 */
import { type MutableRefObject } from "react";
import type { AdminTranslate } from "../lib/admin-copy.ts";
import { type AdminFailureView, type AdminField, type AdminResetValues } from "./admin-reset.ts";
import type { AdminSuccessView } from "../ui/admin-fields.tsx";
/** 表单阶段：编辑 → 确认 → 提交。 */
export type AdminResetStage = "editing" | "confirm" | "submitting";
/** 重置控制器：值 / 阶段 / 双锁 / 结果 / 阶段切换动作。 */
export interface AdminResetController {
    values: AdminResetValues;
    stage: AdminResetStage;
    failure: AdminFailureView | null;
    success: AdminSuccessView | null;
    composing: MutableRefObject<boolean>;
    setValue: (field: AdminField, value: string) => void;
    /** 第一次提交：本地校验通过后进入确认页，不发请求。 */
    review: () => void;
    /** 确认页「返回修改」：保留全部值回到编辑。 */
    back: () => void;
    /** 确认页「确认重置」：真正发请求。 */
    confirm: () => Promise<void>;
    /** 取消整个重置流程并清空。 */
    cancel: () => void;
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
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
}
/** hook 的入参。 */
export interface UseAdminResetOptions {
    t: AdminTranslate;
    actorTotpEnabled: boolean;
    /** A7：成功回调（管理块用它重拉列表刷新徽标）；失败路径不调用。 */
    onReset?: (() => void) | undefined;
}
/** 重置状态机：编辑 → 确认 → 提交，双锁 + abort + 卸载保护。 */
export declare function useAdminReset({ t, actorTotpEnabled, onReset, }: UseAdminResetOptions): AdminResetController;
