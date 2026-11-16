/**
 * 原生按钮 + 内联样式（重设计 2026-11-16）。
 *
 * 为什么需要它：仓库没有 CSS 文件，`:hover` / `:active` 这类伪类用不了，只能靠
 * `onMouseEnter` / `onMouseLeave` 切 state。三个 feature 都要这套逻辑，放 shared
 * 里复用，但**不带任何业务文案或跨 feature 状态**（FSD 纪律）。
 *
 * 语义保持原生：`type` 默认 `button`（表单里的提交按钮必须显式传 `submit`），
 * 调用方给的 `aria-*` / `ref` / `disabled` 原样透传，不吞。
 */
import { type ButtonHTMLAttributes } from "react";
/** 按钮视觉档位：主任务 / 次级 / 危险。 */
export type ActionButtonVariant = "primary" | "ghost" | "danger";
export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** 视觉档位，默认 `primary`。 */
    variant?: ActionButtonVariant;
    /** 请求在飞：置灰 + 禁用，但不移除（避免布局跳动）。 */
    busy?: boolean;
}
/**
 * 带 hover 反馈的原生按钮。
 *
 * `type` 默认 `button`：表单里的提交按钮必须显式写 `type="submit"`，避免误触发表单。
 */
export declare const ActionButton: import("react").ForwardRefExoticComponent<ActionButtonProps & import("react").RefAttributes<HTMLButtonElement>>;
//# sourceMappingURL=action-button.d.ts.map