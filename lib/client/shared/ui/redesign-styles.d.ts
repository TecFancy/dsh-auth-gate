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
/** 区标题行：标题在左，动作（数量徽标 / 添加按钮）在右。 */
export declare const SECTION_HEADING_STYLE: CSSProperties;
/** 区标题右侧的动作组。 */
export declare const SECTION_ACTIONS_STYLE: CSSProperties;
/** 行式字段：左标签 + 右控件，与宿主设置页同形。 */
export declare const FIELD_ROW_STYLE: CSSProperties;
/** 行式字段的标签（可换行，长英文标签不撑破列宽）。 */
export declare const FIELD_LABEL_STYLE: CSSProperties;
/** 行式字段的控件列：纵向排布输入 + 帮助文本。 */
export declare const FIELD_CONTROL_STYLE: CSSProperties;
/** 行式字段里的输入框（宽度撑满控件列）。 */
export declare const ROW_INPUT_STYLE: CSSProperties;
/** 行式字段里校验失败的输入框。 */
export declare const ROW_INVALID_INPUT_STYLE: CSSProperties;
/** 次级按钮（ghost）：透明底 + 描边，用于「添加」「取消」这类非主任务动作。 */
export declare const GHOST_BUTTON_STYLE: CSSProperties;
/** 次级按钮的 hover / 按下态（内联样式没有伪类，靠 state 切换）。 */
export declare const GHOST_BUTTON_ACTIVE_STYLE: CSSProperties;
/** 次级按钮的禁用态。 */
export declare const GHOST_BUTTON_BUSY_STYLE: CSSProperties;
/**
 * 危险按钮：透明底 + 错误色描边与文字。
 *
 * 不复用黑色主按钮：删除凭据、确认重置这类动作不该和主任务同权重（评审 F3）。
 */
export declare const DANGER_BUTTON_STYLE: CSSProperties;
/** 危险按钮的 hover / 按下态。 */
export declare const DANGER_BUTTON_ACTIVE_STYLE: CSSProperties;
/** 危险按钮的禁用态。 */
export declare const DANGER_BUTTON_BUSY_STYLE: CSSProperties;
/**
 * 就地确认区（删除凭据 / 重置他人密码）。
 *
 * 识别靠**描边 + 左侧竖条**，不靠底色：实测 `state-warn-tertiary` 与所在表面的
 * 对比度浅色 1.06、深色 1.02，等于看不见（评审 F3）。底色只作辅助。
 */
export declare const CONFIRM_PANEL_STYLE: CSSProperties;
/** 确认区标题。 */
export declare const CONFIRM_TITLE_STYLE: CSSProperties;
/** 确认区里的后果说明。 */
export declare const CONFIRM_WARNING_STYLE: CSSProperties;
/** 确认区底部的动作行：安全动作在左，危险动作在右（避免双击同坐标完成破坏）。 */
export declare const CONFIRM_ACTIONS_STYLE: CSSProperties;
/** 空态块：浅底 + 一句说明 + 一个下一步动作。 */
export declare const EMPTY_STATE_STYLE: CSSProperties;
/** 账号上下文行：本地账号 + 角色 / 两步验证徽标。 */
export declare const ACCOUNT_CONTEXT_STYLE: CSSProperties;
/** 上下文行里的账号名。 */
export declare const ACCOUNT_CONTEXT_NAME_STYLE: CSSProperties;
/** 凭据行的元数据行（创建 / 最近使用 / 备份），12px 三级色。 */
export declare const CREDENTIAL_META_STYLE: CSSProperties;
/** 屏幕阅读器专用（表格 caption 这类需要语义但不需要视觉的文本）。 */
export declare const VISUALLY_HIDDEN_STYLE: CSSProperties;
