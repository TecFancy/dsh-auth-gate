import type { CSSProperties } from "react";

/**
 * account 面板样式：颜色只取宿主设计 token（`--dsw-*`），不硬编码色值，
 * 跟随主题/明暗切换。几何（间距/圆角/字号）照 logout-action.tsx 现状自绘。
 */

/** 面板根部：纵向排布；`minHeight: 0` 让本页在设置内容列里参与收缩，列内可滚动。 */
export const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minHeight: 0,
  padding: "4px 0 8px",
  color: "var(--dsw-alias-label-primary)",
  fontFamily: "var(--dsw-font-family)",
};

export const TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  lineHeight: "24px",
  color: "var(--dsw-alias-label-primary)",
};

/** 标题行（P1.1）：自带图标 + 文案横排，图标随文字色（currentColor）跟随主题。 */
export const TITLE_ROW_STYLE: CSSProperties = {
  ...TITLE_STYLE,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

export const HINT_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: "20px",
  color: "var(--dsw-alias-label-tertiary)",
};

export const FORM_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  maxWidth: 420,
};

export const LABEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  lineHeight: "20px",
  color: "var(--dsw-alias-label-secondary)",
};

/** 输入框基线。 */
const INPUT_BASE: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-2)",
  color: "var(--dsw-alias-label-primary)",
  fontFamily: "inherit",
  fontSize: 14,
  lineHeight: "22px",
};

export const INPUT_STYLE: CSSProperties = INPUT_BASE;

/** 校验失败字段（契约 §1 的 401/400 分支）加错误描边。 */
export const INVALID_INPUT_STYLE: CSSProperties = {
  ...INPUT_BASE,
  border: "1px solid var(--dsw-alias-state-error-primary)",
};

export const STATUS_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minHeight: 20,
  fontSize: 13,
  lineHeight: "20px",
};

export const ERROR_TEXT_STYLE: CSSProperties = {
  color: "var(--dsw-alias-label-error)",
};

export const SUCCESS_TEXT_STYLE: CSSProperties = {
  color: "var(--dsw-alias-state-success-primary)",
};

export const RULES_STYLE: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: "var(--dsw-alias-label-error)",
};

export const BUTTON_STYLE: CSSProperties = {
  alignSelf: "flex-start",
  padding: "8px 20px",
  borderRadius: 10,
  border: "1px solid var(--dsw-alias-button-primary-fill)",
  background: "var(--dsw-alias-button-primary-fill)",
  color: "var(--dsw-alias-label-primary-inverted)",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 500,
  lineHeight: "22px",
  cursor: "pointer",
};

/** 提交中（双锁的可见态）：置灰但不移除，避免布局跳动。 */
export const BUTTON_BUSY_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  opacity: 0.6,
  cursor: "default",
};

// ---------------------------------------------------------------------------
// P2 PR2 管理块（admin）：以下全部为**追加**常量，上面既有值一个都不动
// （自助改密页像素稳定性，契约 §2 account-styles 行）。
// ---------------------------------------------------------------------------

/** 管理块根部：与上方自助改密区之间用一条分隔线 + 上间距，纵向排布。 */
export const ADMIN_BLOCK_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 4,
  paddingTop: 12,
  borderTop: "1px solid var(--dsw-alias-border-l2)",
};

/** 用户表：占满宽度、折叠边框；只做排版，不自绘视觉。 */
export const ADMIN_TABLE_STYLE: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  lineHeight: "20px",
  color: "var(--dsw-alias-label-primary)",
};

export const ADMIN_TH_STYLE: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px 6px 0",
  fontWeight: 500,
  color: "var(--dsw-alias-label-tertiary)",
};

export const ADMIN_TD_STYLE: CSSProperties = {
  padding: "6px 8px 6px 0",
  borderTop: "1px solid var(--dsw-alias-border-l2)",
};

/** 只读徽标（角色 / 状态 / 两步验证 / 本人）：浅底 + 次级文字色，随主题切换。 */
export const ADMIN_BADGE_STYLE: CSSProperties = {
  display: "inline-block",
  padding: "0 6px",
  borderRadius: 6,
  background: "var(--dsw-alias-bg-layer-2)",
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 12,
  lineHeight: "18px",
};
