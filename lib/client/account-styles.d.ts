import type { CSSProperties } from "react";
/**
 * account 面板样式：颜色只取宿主设计 token（`--dsw-*`），不硬编码色值，
 * 跟随主题/明暗切换。几何（间距/圆角/字号）照 logout-action.tsx 现状自绘。
 */
/** 面板根部：纵向排布；`minHeight: 0` 让本页在设置内容列里参与收缩，列内可滚动。 */
export declare const PANEL_STYLE: CSSProperties;
export declare const TITLE_STYLE: CSSProperties;
/** 标题行（P1.1）：自带图标 + 文案横排，图标随文字色（currentColor）跟随主题。 */
export declare const TITLE_ROW_STYLE: CSSProperties;
export declare const HINT_STYLE: CSSProperties;
export declare const FORM_STYLE: CSSProperties;
export declare const LABEL_STYLE: CSSProperties;
export declare const INPUT_STYLE: CSSProperties;
/** 校验失败字段（契约 §1 的 401/400 分支）加错误描边。 */
export declare const INVALID_INPUT_STYLE: CSSProperties;
export declare const STATUS_STYLE: CSSProperties;
export declare const ERROR_TEXT_STYLE: CSSProperties;
export declare const SUCCESS_TEXT_STYLE: CSSProperties;
export declare const RULES_STYLE: CSSProperties;
export declare const BUTTON_STYLE: CSSProperties;
/** 提交中（双锁的可见态）：置灰但不移除，避免布局跳动。 */
export declare const BUTTON_BUSY_STYLE: CSSProperties;
/** 管理块根部：与上方自助改密区之间用一条分隔线 + 上间距，纵向排布。 */
export declare const ADMIN_BLOCK_STYLE: CSSProperties;
/** 用户表：占满宽度、折叠边框；只做排版，不自绘视觉。 */
export declare const ADMIN_TABLE_STYLE: CSSProperties;
export declare const ADMIN_TH_STYLE: CSSProperties;
export declare const ADMIN_TD_STYLE: CSSProperties;
/** 只读徽标（角色 / 状态 / 两步验证 / 本人）：浅底 + 次级文字色，随主题切换。 */
export declare const ADMIN_BADGE_STYLE: CSSProperties;
//# sourceMappingURL=account-styles.d.ts.map