// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminStatus,
  AdminTextField,
  ADMIN_CODE_HINT_ID,
  ADMIN_STATUS_ID,
} from "./admin-fields.tsx";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderField(props: {
  field: "password" | "code";
  invalid?: boolean;
  hint?: string;
}): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  act(() => {
    createRoot(container).render(
      createElement(AdminTextField, {
        field: props.field,
        label: `label-${props.field}`,
        value: "",
        invalid: props.invalid ?? false,
        hint: props.hint,
        hintId: props.hint === undefined ? undefined : ADMIN_CODE_HINT_ID,
        onChange,
      }),
    );
  });
  return container;
}

function renderStatus(failure: unknown, success: unknown): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(createElement(AdminStatus, { failure, success } as never));
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AdminTextField：字段语义与 aria（A11）", () => {
  it("新口令框：type=password + autocomplete=new-password + label 关联", () => {
    const container = renderField({ field: "password" });
    const input = container.querySelector("input")!;
    expect(input.getAttribute("type")).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.getAttribute("id")).toBe("dsh-auth-gate-admin-password");
    expect(container.querySelector("label")?.getAttribute("for")).toBe(input.getAttribute("id"));
  });

  it("动态码框：one-time-code + 数字键盘 + hint 关联", () => {
    const container = renderField({ field: "code", hint: "code hint" });
    const input = container.querySelector("input")!;
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(container.querySelector("span")?.getAttribute("id")).toBe(ADMIN_CODE_HINT_ID);
    expect(input.getAttribute("aria-describedby")).toBe(ADMIN_CODE_HINT_ID);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("错误态：aria-invalid=true + 指向状态位 + 错误描边", () => {
    const container = renderField({ field: "password", invalid: true });
    const input = container.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(ADMIN_STATUS_ID);
    expect(input.style.border).toContain("error");
  });
});

describe("AdminStatus：两种播报语义（A8 / A11）", () => {
  it("idle：常驻空播报位", () => {
    const container = renderStatus(null, null);
    const status = container.querySelector(`#${ADMIN_STATUS_ID}`)!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
  });

  it("failure：消息 + 规则列表（错误色）", () => {
    const container = renderStatus(
      { message: "bad password", rules: ["rule-a", "rule-b"], fields: ["password"] },
      null,
    );
    expect(container.textContent).toContain("bad password");
    expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "rule-a",
      "rule-b",
    ]);
  });

  it("成功：role=status + polite + 成功色", () => {
    const container = renderStatus(null, { text: "done", warning: false });
    const status = container.querySelector(`#${ADMIN_STATUS_ID}`)!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("done");
    expect(status.querySelector<HTMLElement>("span")?.style.color).toContain("success");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("安全失败（sessionsRevoked:false）：role=alert + assertive + 错误色", () => {
    const container = renderStatus(null, { text: "sessions kept", warning: true });
    const alert = container.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("sessions kept");
    expect(alert.style.color).toContain("error");
    expect(container.querySelector(`#${ADMIN_STATUS_ID}`)!.textContent).toBe("");
  });
});
