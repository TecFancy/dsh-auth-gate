import { type AccountTranslate } from "../../../shared/i18n/index.ts";
import type { PasskeyReauthValues } from "../model/passkey-form.ts";
/** 删除确认区的字段 id（与添加表单分开，避免同 id 冲突）。 */
export declare function reauthFieldId(field: "password" | "code"): string;
export interface PasskeyRemoveFormProps {
    t: AccountTranslate;
    /** 要删的凭据名称（显示在标题里，让用户确认删的是哪一把）。 */
    label: string;
    values: PasskeyReauthValues;
    /** 需要标红的字段。 */
    invalid: ("label" | "password" | "code")[];
    /** 请求在飞。 */
    busy: boolean;
    /** 当前账号是否开启两步验证：决定动态码框的提示文案。 */
    totpEnabled?: boolean | undefined;
    onChange: (field: "password" | "code", value: string) => void;
    onCancel: () => void;
    onConfirm: () => void | Promise<void>;
}
/** 删除确认区：标题（含凭据名）+ 后果说明 + 再认证字段 + 取消/确认。 */
export declare function PasskeyRemoveForm({ t, label, values, invalid, busy, totpEnabled, onChange, onCancel, onConfirm, }: PasskeyRemoveFormProps): import("react").JSX.Element;
//# sourceMappingURL=passkey-remove-form.d.ts.map