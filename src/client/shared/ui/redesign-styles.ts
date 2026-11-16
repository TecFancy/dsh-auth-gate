/**
 * 重设计（2026-11-16）新增的样式常量：行式布局、区标题行、次级/危险按钮、就地确认区。
 *
 * 与 `account-styles.ts` 分开的原因：那个文件已经 169 行，再塞 220 行会撞 250 行红线。
 * 两个文件都只导出 `CSSProperties`，没有逻辑，谁 import 谁都不产生耦合。
 *
 * 颜色只取宿主 token；几何照宿主「通用设置」页的实测基线
 * （14px/22px 正文、12px/18px 说明、1px `border-l1` 分隔）。
 */
import type { CSSProperties } from "react";
import { INPUT_STYLE, INVALID_INPUT_STYLE } from "./account-styles.ts";

/** 区标题行：标题在左，动作（数量徽标 / 添加按钮）在右。 */
export const SECTION_HEADING_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minHeight: 24,
};

/** 区标题右侧的动作组。 */
export const SECTION_ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flex: "none",
};

/** 行式字段：左标签 + 右控件，与宿主设置页同形。 */
export const FIELD_ROW_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "148px minmax(0, 1fr)",
  alignItems: "start",
  gap: 16,
  padding: "8px 0",
  borderTop: "1px solid var(--dsw-alias-border-l1)",
};

/** 行式字段的标签（可换行，长英文标签不撑破列宽）。 */
export const FIELD_LABEL_STYLE: CSSProperties = {
  fontSize: 14,
  lineHeight: "22px",
  color: "var(--dsw-alias-label-primary)",
  paddingTop: 7,
  overflowWrap: "anywhere",
};

/** 行式字段的控件列：纵向排布输入 + 帮助文本。 */
export const FIELD_CONTROL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
};

/** 行式字段里的输入框（宽度撑满控件列）。 */
export const ROW_INPUT_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  width: "100%",
};

/** 行式字段里校验失败的输入框。 */
export const ROW_INVALID_INPUT_STYLE: CSSProperties = {
  ...INVALID_INPUT_STYLE,
  width: "100%",
};

/** 次级按钮（ghost）：透明底 + 描边，用于「添加」「取消」这类非主任务动作。 */
export const GHOST_BUTTON_STYLE: CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "transparent",
  color: "var(--dsw-alias-label-primary)",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: "20px",
  cursor: "pointer",
};

/** 次级按钮的 hover / 按下态（内联样式没有伪类，靠 state 切换）。 */
export const GHOST_BUTTON_ACTIVE_STYLE: CSSProperties = {
  ...GHOST_BUTTON_STYLE,
  background: "var(--dsw-alias-button-ghost-active-fill)",
  borderColor: "var(--dsw-alias-button-ghost-active-border)",
};

/** 次级按钮的禁用态。 */
export const GHOST_BUTTON_BUSY_STYLE: CSSProperties = {
  ...GHOST_BUTTON_STYLE,
  opacity: 0.6,
  cursor: "default",
};

/**
 * 危险按钮：透明底 + 错误色描边与文字。
 *
 * 不复用黑色主按钮：删除凭据、确认重置这类动作不该和主任务同权重（评审 F3）。
 */
export const DANGER_BUTTON_STYLE: CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-state-error-primary)",
  background: "transparent",
  color: "var(--dsw-alias-state-error-primary)",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: "20px",
  cursor: "pointer",
};

/** 危险按钮的 hover / 按下态。 */
export const DANGER_BUTTON_ACTIVE_STYLE: CSSProperties = {
  ...DANGER_BUTTON_STYLE,
  background: "var(--dsw-alias-interactive-bg-hover-danger)",
};

/** 危险按钮的禁用态。 */
export const DANGER_BUTTON_BUSY_STYLE: CSSProperties = {
  ...DANGER_BUTTON_STYLE,
  opacity: 0.6,
  cursor: "default",
};

/**
 * 就地确认区（删除凭据 / 重置他人密码）。
 *
 * 识别靠**描边 + 左侧竖条**，不靠底色：实测 `state-warn-tertiary` 与所在表面的
 * 对比度浅色 1.06、深色 1.02，等于看不见（评审 F3）。底色只作辅助。
 */
export const CONFIRM_PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginTop: 10,
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-state-error-primary)",
  borderLeftWidth: 3,
  background: "var(--dsw-alias-state-warn-tertiary)",
};

/** 确认区标题。 */
export const CONFIRM_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  lineHeight: "22px",
  color: "var(--dsw-alias-label-primary)",
};

/** 确认区里的后果说明。 */
export const CONFIRM_WARNING_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: "var(--dsw-alias-label-secondary)",
};

/** 确认区底部的动作行：安全动作在左，危险动作在右（避免双击同坐标完成破坏）。 */
export const CONFIRM_ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 2,
};

/** 空态块：浅底 + 一句说明 + 一个下一步动作。 */
export const EMPTY_STATE_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 10,
  padding: "14px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l1)",
  background: "var(--dsw-alias-card-fill)",
};

/** 账号上下文行：本地账号 + 角色 / 两步验证徽标。 */
export const ACCOUNT_CONTEXT_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  paddingBottom: 12,
  borderBottom: "1px solid var(--dsw-alias-border-l1)",
  fontSize: 12,
  lineHeight: "18px",
  color: "var(--dsw-alias-label-tertiary)",
};

/** 上下文行里的账号名。 */
export const ACCOUNT_CONTEXT_NAME_STYLE: CSSProperties = {
  fontSize: 14,
  lineHeight: "22px",
  fontWeight: 500,
  color: "var(--dsw-alias-label-primary)",
};

/** 凭据行的元数据行（创建 / 最近使用 / 备份），12px 三级色。 */
export const CREDENTIAL_META_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  fontSize: 12,
  lineHeight: "18px",
  color: "var(--dsw-alias-label-tertiary)",
};

/** 屏幕阅读器专用（表格 caption 这类需要语义但不需要视觉的文本）。 */
export const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};
