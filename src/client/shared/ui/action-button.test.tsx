// @vitest-environment jsdom
/**
 * `ActionButton`：原生语义不被包装破坏。
 *
 * 这个组件存在的唯一理由是补 hover 态，所以测试的重点是「没有因为包装而丢掉
 * 原生 button 的语义」：type 默认值、disabled、ref、aria 透传、事件不吞。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionButton } from "./action-button.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(element: React.ReactElement): HTMLButtonElement {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(element));
  const button = container.querySelector("button");
  if (button === null) throw new Error("no button rendered");
  return button;
}

describe("ActionButton", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    expect(render(createElement(ActionButton, null, "x")).type).toBe("button");
  });

  it("keeps an explicit type=submit", () => {
    expect(render(createElement(ActionButton, { type: "submit" }, "x")).type).toBe("submit");
  });

  it("disables the button while busy without removing it", () => {
    const button = render(createElement(ActionButton, { busy: true }, "x"));
    expect(button.disabled).toBe(true);
    expect(button.isConnected).toBe(true);
  });

  it("passes aria attributes and refs through", () => {
    const ref = { current: null as HTMLButtonElement | null };
    const button = render(
      createElement(ActionButton, { ref, "aria-expanded": "true", "aria-controls": "panel" }, "x"),
    );
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe("panel");
    expect(ref.current).toBe(button);
  });

  it("does not swallow the caller's own mouse handlers", () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const button = render(createElement(ActionButton, { onMouseEnter, onMouseLeave }, "x"));
    act(() => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });

  it("renders the three variants without throwing", () => {
    for (const variant of ["primary", "ghost", "danger"] as const) {
      const button = render(createElement(ActionButton, { variant }, "x"));
      expect(button.textContent).toBe("x");
      act(() => root?.unmount());
      container?.remove();
      root = null;
      container = null;
    }
  });
});
