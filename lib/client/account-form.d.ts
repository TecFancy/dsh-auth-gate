import { type AccountTranslate } from "./account-copy.ts";
/**
 * 改密表单 props：`t` 来自槽位 locale seat。
 * 宿主 owner props 里还有 `close`（关闭设置弹窗），P1.1 起**刻意不再使用**：成功后去向由
 * 服务端会话状态决定（立即去登录页），关掉弹窗只会在死会话 SPA 上留下用户。
 */
export interface AccountPasswordFormProps {
    t: AccountTranslate;
}
/** 已登录时的自助改密表单（成功后立即跳登录页；成功态面板只是兜底）。 */
export declare function AccountPasswordForm({ t }: AccountPasswordFormProps): import("react").JSX.Element;
//# sourceMappingURL=account-form.d.ts.map