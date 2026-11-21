import type { AccountTranslate } from "../../../shared/i18n/index.ts";
import { type PasskeyFailureView, type PasskeyFormValues, type PasskeyReauthValues } from "./passkey-form.ts";
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
/**
 * 添加/删除的提交状态机。`onChanged` 在成功后调用（父组件用它刷新列表）。
 * 用户取消系统验证器（AbortError/NotAllowedError）静默回退：不显示错误、恢复按钮。
 */
export declare function usePasskeyActions(t: AccountTranslate, onChanged: () => void): PasskeyActions;
