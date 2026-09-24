import { type AccountTranslate } from "./account-copy.ts";
/**
 * 槽位注入的 props：`t` 来自注册时的 `locale: "auth"` seat。
 * 宿主 owner props 还有 `close`；P1.1 起不再往下传（成功后去登录页，而不是关弹窗）。
 */
export interface SettingsAccountSectionProps {
    t?: AccountTranslate | undefined;
}
/**
 * 「账户」设置页（`settings.section`）：未登录不给表单；已登录渲染自助改密表单，
 * 并在身份满足渲染门时（admin + 正式会话）追加管理块。`t` 缺失时降级到英文词典
 * （不显示键名），由 account-form / admin-block 承担各自的提交逻辑。
 */
export declare function SettingsAccountSection({ t }: SettingsAccountSectionProps): import("react").JSX.Element;
//# sourceMappingURL=account-section.d.ts.map