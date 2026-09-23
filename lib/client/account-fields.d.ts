import { type AccountTranslate } from "./account-copy.ts";
import type { FailureView, FieldName, FormValues } from "./account-submit.ts";
/** 状态区 id：aria-live 播报位，也是错误字段 aria-describedby 的落点（成功态复用）。 */
export declare const ACCOUNT_STATUS_ID = "dsh-auth-gate-account-status";
interface PasswordFieldsProps {
    t: AccountTranslate;
    values: FormValues;
    isInvalid: (field: FieldName) => boolean;
    onChange: (field: FieldName, value: string) => void;
}
/** 四字段（current / password / confirm / code），autocomplete 按语义固定。 */
export declare function PasswordFields({ t, values, isInvalid, onChange }: PasswordFieldsProps): import("react").JSX.Element;
/** 状态区：常驻 DOM 的 aria-live 播报位（idle 时留空，避免读屏漏播）。 */
export declare function StatusLine({ failure }: {
    failure: FailureView | null;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=account-fields.d.ts.map