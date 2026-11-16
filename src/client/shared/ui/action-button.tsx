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
import { forwardRef, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { BUTTON_BUSY_STYLE, BUTTON_STYLE } from "./account-styles.ts";
import {
  DANGER_BUTTON_ACTIVE_STYLE,
  DANGER_BUTTON_BUSY_STYLE,
  DANGER_BUTTON_STYLE,
  GHOST_BUTTON_ACTIVE_STYLE,
  GHOST_BUTTON_BUSY_STYLE,
  GHOST_BUTTON_STYLE,
} from "./redesign-styles.ts";

/** 按钮视觉档位：主任务 / 次级 / 危险。 */
export type ActionButtonVariant = "primary" | "ghost" | "danger";

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉档位，默认 `primary`。 */
  variant?: ActionButtonVariant;
  /** 请求在飞：置灰 + 禁用，但不移除（避免布局跳动）。 */
  busy?: boolean;
}

/** 档位 → 三态样式（常态 / hover / busy）。 */
const VARIANTS: Record<
  ActionButtonVariant,
  { base: CSSProperties; active: CSSProperties; busy: CSSProperties }
> = {
  primary: { base: BUTTON_STYLE, active: BUTTON_STYLE, busy: BUTTON_BUSY_STYLE },
  ghost: {
    base: GHOST_BUTTON_STYLE,
    active: GHOST_BUTTON_ACTIVE_STYLE,
    busy: GHOST_BUTTON_BUSY_STYLE,
  },
  danger: {
    base: DANGER_BUTTON_STYLE,
    active: DANGER_BUTTON_ACTIVE_STYLE,
    busy: DANGER_BUTTON_BUSY_STYLE,
  },
};

/** 三态选一：禁用 > hover > 常态（拆出来是为了不写嵌套三元）。 */
function pickStyle(
  styles: { base: CSSProperties; active: CSSProperties; busy: CSSProperties },
  isDisabled: boolean,
  hovered: boolean,
): CSSProperties {
  if (isDisabled) return styles.busy;
  return hovered ? styles.active : styles.base;
}

/**
 * 带 hover 反馈的原生按钮。
 *
 * `type` 默认 `button`：表单里的提交按钮必须显式写 `type="submit"`，避免误触发表单。
 */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { variant = "primary", busy = false, disabled, style, type = "button", ...rest },
  ref,
) {
  const [hovered, setHovered] = useState(false);
  const styles = VARIANTS[variant];
  const isDisabled = disabled === true || busy;
  const base = pickStyle(styles, isDisabled, hovered);
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isDisabled}
      style={style === undefined ? base : { ...base, ...style }}
      onMouseEnter={(event) => {
        setHovered(true);
        rest.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        rest.onMouseLeave?.(event);
      }}
    />
  );
});
