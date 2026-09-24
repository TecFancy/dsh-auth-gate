// @vitest-environment jsdom
/**
 * 导航行图标垫片（D24.1）的行为。
 *
 * 这里钉的是"我们那一行被换成盾牌、别人的行一个都不碰、宿主重渲染后自愈、dispose 后不再
 * 动手、没有 DOM 时 no-op"。"不闪"是时序性质（观察器回调是微任务，先于绘制），由隔离实例的
 * rAF 逐帧探针验证，不在单测里假装。
 */
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, ACCOUNT_KEYS } from "./account-copy.ts";
import { ACCOUNT_ICON_PATHS, ACCOUNT_ICON_VIEW_BOX } from "./account-icon.ts";
import { installAccountNavIcon, NAV_GLYPH_ATTR } from "./account-nav-icon.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const ZH_LABEL = ACCOUNT_DICT_ZH[ACCOUNT_KEYS.nav] ?? "";
const EN_LABEL = ACCOUNT_DICT_EN[ACCOUNT_KEYS.nav] ?? "";

interface Row {
  button: HTMLButtonElement;
  icon: SVGSVGElement;
  label: HTMLSpanElement;
}

/** 宿主导航行的形：`<button>[<svg/>, <span>label</span>]`。 */
function makeRow(label: string): Row {
  const button = document.createElement("button");
  button.type = "button";
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  button.append(icon, labelEl);
  return { button, icon, label: labelEl };
}

function glyphsIn(button: Element): NodeListOf<Element> {
  return button.querySelectorAll(`svg[${NAV_GLYPH_ATTR}]`);
}

/** 等一轮任务：MutationObserver 回调是微任务，留一拍给测试环境结算。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let dispose: (() => void) | null = null;

function install(): void {
  dispose = installAccountNavIcon(document);
}

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = "";
});

describe("installAccountNavIcon: matching and painting", () => {
  it("replaces the host gear with our glyph in our row", async () => {
    install();
    const row = makeRow(ZH_LABEL);
    document.body.appendChild(row.button);
    await settle();
    expect(row.icon.style.display).toBe("none");
    const glyph = glyphsIn(row.button);
    expect(glyph).toHaveLength(1);
    expect(glyph[0]?.getAttribute("viewBox")).toBe(ACCOUNT_ICON_VIEW_BOX);
    expect(glyph[0]?.querySelectorAll("path")).toHaveLength(ACCOUNT_ICON_PATHS.length);
    expect(glyph[0]?.getAttribute("aria-hidden")).toBe("true");
    // 顺序：[我们的图标, 宿主图标(藏起来), 文案]；宿主节点仍在 DOM 里（我们没有删 React 的节点）。
    expect(Array.from(row.button.children).map((c) => c.tagName)).toEqual(["svg", "svg", "SPAN"]);
    expect(row.button.contains(row.icon)).toBe(true);
    expect(row.button.lastElementChild).toBe(row.label);
  });

  it("patches within the same microtask checkpoint (no animation frame needed)", async () => {
    install();
    const row = makeRow(ZH_LABEL);
    document.body.appendChild(row.button);
    await Promise.resolve();
    expect(glyphsIn(row.button)).toHaveLength(1);
    expect(row.icon.style.display).toBe("none");
  });

  it("also fixes a rail that is already open when the shim installs", () => {
    const row = makeRow(ZH_LABEL);
    document.body.appendChild(row.button);
    install();
    expect(glyphsIn(row.button)).toHaveLength(1);
    expect(row.icon.style.display).toBe("none");
  });

  it("never touches the host's own rows", async () => {
    install();
    const host = makeRow("通用设置");
    document.body.appendChild(host.button);
    await settle();
    expect(glyphsIn(host.button)).toHaveLength(0);
    expect(host.icon.style.display).toBe("");
  });

  it("recognises the English label too (language switch keeps the row matched)", async () => {
    install();
    const row = makeRow(EN_LABEL);
    document.body.appendChild(row.button);
    await settle();
    expect(glyphsIn(row.button)).toHaveLength(1);
  });

  it("leaves a row alone when there is no host icon to replace", async () => {
    install();
    const button = document.createElement("button");
    const label = document.createElement("span");
    label.textContent = ZH_LABEL;
    button.append(label);
    document.body.appendChild(button);
    await settle();
    expect(glyphsIn(button)).toHaveLength(0);
  });

  it("ignores a row whose label is not the last element child (future host shape)", async () => {
    install();
    const row = makeRow(ZH_LABEL);
    row.button.append(document.createElementNS(SVG_NS, "svg")); // 文案后面又跟了图元
    document.body.appendChild(row.button);
    await settle();
    expect(glyphsIn(row.button)).toHaveLength(0);
    expect(row.icon.style.display).toBe("");
  });
});

describe("installAccountNavIcon: lifecycle", () => {
  it("re-hides the gear when the host rewrites the icon's inline style", async () => {
    install();
    const row = makeRow(ZH_LABEL);
    document.body.appendChild(row.button);
    await settle();
    row.icon.style.display = ""; // 宿主（未来的版本）把我们的隐藏覆盖掉
    await settle();
    expect(row.icon.style.display).toBe("none");
    expect(glyphsIn(row.button)).toHaveLength(1);
  });

  it("hides a host icon that React re-created, without stacking glyphs", async () => {
    install();
    const row = makeRow(ZH_LABEL);
    document.body.appendChild(row.button);
    await settle();
    const replacement = document.createElementNS(SVG_NS, "svg");
    row.button.replaceChild(replacement, row.icon);
    await settle();
    expect(replacement.style.display).toBe("none");
    expect(glyphsIn(row.button)).toHaveLength(1);
  });

  it("stops reacting after dispose", async () => {
    install();
    dispose?.();
    dispose = null;
    const row = makeRow(ZH_LABEL);
    document.body.appendChild(row.button);
    await settle();
    expect(glyphsIn(row.button)).toHaveLength(0);
    expect(row.icon.style.display).toBe("");
  });

  it("puts the host icon back when disposed (uninstall restores the row)", async () => {
    install();
    const row = makeRow(ZH_LABEL);
    document.body.appendChild(row.button);
    await settle();
    expect(glyphsIn(row.button)).toHaveLength(1);
    expect(row.icon.style.display).toBe("none");
    dispose?.();
    dispose = null;
    expect(glyphsIn(row.button)).toHaveLength(0);
    expect(row.icon.style.display).toBe("");
  });

  it("is a no-op without a document (node test environment)", () => {
    expect(installAccountNavIcon(undefined)).toBeTypeOf("function");
  });
});
