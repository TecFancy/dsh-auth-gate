import { type AccountTranslate } from "./account-copy.ts";
/** 改密表单 props：`t` 来自槽位 locale seat，`close` 是宿主 owner props。 */
export interface AccountPasswordFormProps {
    t: AccountTranslate;
    close?: (() => void) | undefined;
}
/** 已登录时的自助改密表单（成功后整页换成提示 + owner 的 close 按钮）。 */
export declare function AccountPasswordForm({ t, close }: AccountPasswordFormProps): import("react").JSX.Element;
//# sourceMappingURL=account-form.d.ts.map