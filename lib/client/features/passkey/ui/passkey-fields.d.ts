/**
 * passkey 区块的共享展示件：id 常量、输入行、状态播报位。
 *
 * 只被 `passkey-block.tsx` / `passkey-settings-toggle.tsx` 单向 import；本文件不 import 它们
 * （避免循环）。样式全部复用 `shared/ui` 的既有常量，不新增视觉语言。
 */
import type { PasskeyField, PasskeyFailureView } from "../model/passkey-form.ts";
/** 状态播报位：aria-live 落点，也是错误字段 aria-describedby 的目标。 */
export declare const PASSKEY_STATUS_ID = "dsh-auth-gate-passkey-status";
export declare const PASSKEY_CODE_HINT_ID = "dsh-auth-gate-passkey-code-hint";
/** 字段 id（label htmlFor / aria 关联复用）。 */
export declare function passkeyFieldId(field: PasskeyField): string;
/** 带 label / 错误描边 / aria 关联的输入行。 */
export declare function PasskeyTextField({ field, label, type, autoComplete, value, invalid, onChange, hint, hintId, inputMode, }: {
    field: PasskeyField;
    label: string;
    type: "text" | "password";
    autoComplete: string;
    value: string;
    invalid: boolean;
    onChange: (value: string) => void;
    hint?: string | undefined;
    hintId?: string | undefined;
    inputMode?: "numeric" | undefined;
}): import("react").JSX.Element;
/** 状态区：失败消息（错误色）+ 就地成功文案（成功色），常驻 aria-live 播报位。 */
export declare function PasskeyStatus({ failure, success, }: {
    failure: PasskeyFailureView | null;
    success: string | null;
}): import("react").JSX.Element;
//# sourceMappingURL=passkey-fields.d.ts.map