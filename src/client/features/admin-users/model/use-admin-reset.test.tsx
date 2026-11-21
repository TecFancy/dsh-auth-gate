// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy } from "../../../shared/i18n/index.ts";
import { ADMIN_DICT_ZH, type AdminTranslate } from "../lib/admin-copy.ts";
import { useAdminReset, type AdminResetController } from "./use-admin-reset.ts";

/**
 * 管理重置状态机（C4 焦点时序 / C5 函数式更新）。
 *
 * 用探针组件直接拿 controller：这两个缺陷都在「同一次渲染的两次写入」与「确认页卸下后
 * 焦点何时落」这类**时序**上，跑完整表单会被事件派发之间的重渲染掩盖。
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t: AdminTranslate = (key, params) =>
  formatCopy({ ...ACCOUNT_DICT_ZH, ...ADMIN_DICT_ZH }[key] ?? key, params);

let controller: AdminResetController | null = null;

function Probe(): ReactElement {
  controller = useAdminReset({ t, actorTotpEnabled: false });
  return createElement("pre", { "data-testid": "values" }, JSON.stringify(controller.values));
}

async function mount(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
    await Promise.resolve();
  });
  return { root, container };
}

afterEach(() => {
  document.body.innerHTML = "";
  controller = null;
});

/** 每次 State 更新都会重新渲染探针（controller 换成新对象），断言必须读最新的那一份。 */
function latest(): AdminResetController {
  if (controller === null) throw new Error("controller missing");
  return controller;
}

describe("useAdminReset: setValue (C5)", () => {
  it("keeps both writes when two fields change in the same tick", async () => {
    const { root } = await mount();
    // 同一 tick 连写两个字段：写回渲染闭包里旧 values 的实现会让第二次覆盖第一次。
    await act(async () => {
      latest().setValue("password", "first");
      latest().setValue("confirm", "second");
      await Promise.resolve();
    });
    expect(latest().values.password).toBe("first");
    expect(latest().values.confirm).toBe("second");
    act(() => {
      root.unmount();
    });
  });

  it("clears the previous failure on edit", async () => {
    const { root } = await mount();
    await act(async () => {
      latest().setValue("target", "");
      await Promise.resolve();
    });
    act(() => {
      latest().review(); // 空 target → 本地校验失败
    });
    expect(latest().failure?.fields).toEqual(["target"]);
    act(() => {
      latest().setValue("target", "alice");
    });
    expect(latest().failure).toBeNull();
    act(() => {
      root.unmount();
    });
  });
});
