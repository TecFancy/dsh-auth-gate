import { type AccountTranslate } from "./account-copy.ts";
/** 槽位注入的 props：`t` 来自注册时的 `locale: "auth"` seat，`close` 是宿主 owner props。 */
export interface SettingsAccountSectionProps {
    t?: AccountTranslate | undefined;
    close?: (() => void) | undefined;
}
/**
 * 「账户」设置页（`settings.section`）：未登录不给表单；已登录渲染自助改密表单。
 * `t` 缺失时降级到英文词典（不显示键名），由 account-form 承担全部提交逻辑。
 */
export declare function SettingsAccountSection({ t, close }: SettingsAccountSectionProps): import("react").JSX.Element;
//# sourceMappingURL=account-section.d.ts.map