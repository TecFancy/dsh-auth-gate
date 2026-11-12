import type { AccountTranslate } from "../../../shared/i18n/index.ts";
import { type PasskeyFailureView, type PasskeyFormValues } from "./passkey-form.ts";
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
/**
 * 添加/删除的提交状态机。`onChanged` 在成功后调用（父组件用它刷新列表）。
 * 用户取消（AbortError/NotAllowedError）静默回退：不显示错误、恢复按钮。
 */
export declare function usePasskeyActions(t: AccountTranslate, onChanged: () => void): PasskeyActions;
//# sourceMappingURL=use-passkey-actions.d.ts.map