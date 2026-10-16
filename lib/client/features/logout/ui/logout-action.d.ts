/** 槽位渲染器按注册 `locale` 注入的 translate 形（本插件 `auth` 词典的 `logout` 键）。 */
export type LogoutTranslate = (key: string, params?: Record<string, unknown>) => string;
/** 设置面板里的登出按钮组件（`settings.general.item` 槽，root 作用域）。 */
export interface SettingsLogoutActionProps {
    /** 注入的本地化 translate（locale seat）。 */
    t?: LogoutTranslate;
}
/**
 * 可复用的登出提交按钮：原生 form POST（零 JS 依赖）+ 16px 方块图标 + 本地化文字。
 * 渲染进 `settings.general.item`（设置 → 通用设置 的追加行槽，order 30 → 页面底部），
 * 水平居中的醒目 CTA；文案随界面语言在「退出登录」/ "Sign out" 间切换。
 */
export declare function SettingsLogoutAction({ t }: SettingsLogoutActionProps): import("react").JSX.Element | null;
//# sourceMappingURL=logout-action.d.ts.map