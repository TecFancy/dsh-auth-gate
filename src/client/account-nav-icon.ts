/**
 * 「账号安全」导航行图标：临时 DOM 垫片（D24.1）。
 *
 * **为什么需要它**：宿主 `settings.section` 只投影 `id`/`order`/`label`，导航图标由
 * `@deepseek-ai/dsh-client-ui-settings-general` 里硬编码的 `navIcon(id)` if 链给出
 * （0.1.5-rc.2 只认 models / agent-presets / plugins，0.1.7-alpha.2 多认官方 `account`），
 * 第三方段一律落到默认齿轮。插件侧没有图标挂载点，所以这里只对我们自己那一行做一次
 * 视觉替换：把宿主齿轮 `display:none`，在它前面插进我们自设计的盾牌 SVG。
 *
 * **不闪**：观察器在插件 `apply()` 时就装好，远早于设置浮层出现；宿主 React 提交 DOM 后，
 * MutationObserver 回调作为**微任务**在同一个任务里排队，而浏览器绘制发生在微任务清空之后。
 * 因此"宿主图标进入 DOM / 被重写内联样式"这件事总是在画出那一帧之前被修正为"藏起来 + 我们的
 * 图标在场"，无论它发生在浮层整体插入的同一次提交、还是后来的某一次提交（后到的那次插入本身
 * 也会触发回调）。隔离实例里用 rAF 逐帧探针（每帧记录行内图标状态）验过：出现行的第一帧即已是
 * 盾牌，0 帧出现齿轮。
 *
 * **只碰我们这一行**：判定条件是「`<button>` 的最后一个元素子节点是 `<span>` 且文本等于
 * `账号安全` / `Account security`，并且至少有一颗直接子 `<svg>`」（宿主导航行的形：
 * `[icon, label]`）。找不到、宿主换了结构、或页面里还没有这一行时**什么都不做**，用户看到的
 * 仍是宿主齿轮，不会更糟。
 *
 * **自愈**：每次相关 DOM 变化都重跑同步（藏掉行内**直接子级**里除我们之外的所有 svg，缺了就补一个），
 * 因此宿主重渲染、重复同步都不会留下重复图标。disposer 断开观察器并**恢复现场**
 * （宿主齿轮回来、我们的图标摘掉），让卸载回到"没装过"的样子。
 *
 * **上游支持后整体删除**：dsh 给 `settings.section` 加 `icon` 选项（或 `navIcon` 认插件 id）
 * 之日，删掉本文件与 `index.tsx` 里的安装调用，改走官方字段；迁移条件见 ADR D24.1
 * （`docs/decisions/implemented/2026-09-23-post-change-redirect-and-nav-identity.zh.md`）。
 */
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, ACCOUNT_KEYS } from "./account-copy.ts";
import { ACCOUNT_ICON_PATHS, ACCOUNT_ICON_VIEW_BOX } from "./account-icon.ts";

/** 贴在我们插入的 `<svg>` 上的标记属性：宿主不会写它，重同步时靠它认出自己。 */
export const NAV_GLYPH_ATTR = "data-dsh-auth-gate-glyph";

/** SVG 命名空间。 */
const SVG_NS = "http://www.w3.org/2000/svg";

/** 我们这一行的文案（zh/en 两套）：宿主按活动语言投影 `label`，两种都要认出来。 */
const NAV_LABELS = collectLabels();

/** 从两份词典取导航标签（空值不进表，避免匹配到无关的空 label 行）。 */
function collectLabels(): readonly string[] {
  const labels: string[] = [];
  for (const dict of [ACCOUNT_DICT_ZH, ACCOUNT_DICT_EN]) {
    const label = dict[ACCOUNT_KEYS.nav];
    if (label !== undefined && label.length > 0) labels.push(label);
  }
  return labels;
}

/** 直接子级的 `<svg>`（不含 label span 里可能的装饰图元，也不含更深的后代）。 */
function directSvgs(button: Element): SVGElement[] {
  return Array.from(button.children).filter(
    (child): child is SVGElement => child instanceof SVGElement,
  );
}

/** 宿主行结构：`<button>[icon, <span>label</span>]`；只认这种形，别的一律不碰。 */
function isAccountRow(button: Element): boolean {
  if (button.tagName !== "BUTTON") return false;
  const label = button.lastElementChild;
  if (label?.tagName !== "SPAN") return false;
  // 必须有直接子图元（宿主图标）：只认文案不够，避免误伤文案恰好相同的无关按钮。
  if (directSvgs(button).length === 0) return false;
  return NAV_LABELS.includes((label.textContent ?? "").trim());
}

/** 造盾牌图标（路径数据与内容区标题行、`docs/demo/account-security.svg` 同源）。 */
function createGlyph(doc: Document): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute(NAV_GLYPH_ATTR, "1");
  svg.setAttribute("viewBox", ACCOUNT_ICON_VIEW_BOX);
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.flex = "none";
  for (const d of ACCOUNT_ICON_PATHS) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * 把这一行同步成"宿主图标藏起来、我们的图标在场"。
 *
 * 幂等：已有我们的图标就只做隐藏；宿主换了行内结构（没有直接子 svg 可换）则放手不动。
 * 只藏**直接子级**的 svg（宿主以后在同一行加 chevron / 徽标也不会被误伤）。
 * 返回是否真的动过 DOM，供调用方早退。
 */
function syncRow(button: Element): boolean {
  if (button.lastElementChild === null) return false;
  const svgs = directSvgs(button);
  let glyph = svgs.find((svg) => svg.hasAttribute(NAV_GLYPH_ATTR)) ?? null;
  if (glyph === null) {
    const host = svgs[0];
    if (host === undefined) return false;
    glyph = createGlyph(button.ownerDocument);
    // 插在宿主图标**前面**：位置与宿主自己的图标一致（行首），不吃 label 的顺序。
    button.insertBefore(glyph, host);
  }
  for (const svg of directSvgs(button)) {
    if (svg !== glyph) svg.style.display = "none";
  }
  return true;
}

/** 扫一遍容器里的候选行（首次安装、整块浮层被插入时用）。 */
function syncRowsIn(scope: ParentNode): void {
  for (const button of scope.querySelectorAll("button")) {
    if (isAccountRow(button)) syncRow(button);
  }
}

/** 节点自己落在我们那一行里（宿主重渲染换掉行内图标）：重同步所在行。 */
function syncOwner(node: Element): void {
  const owner = node.closest("button");
  if (owner !== null && isAccountRow(owner)) syncRow(owner);
}

/** 新增节点可能整块包含设置浮层（含我们那一行），也可能本身就在我们那一行里。 */
function syncAdded(node: Element): void {
  syncOwner(node);
  // 便宜的先验：新增子树里没有 button 就没什么可同步的（流式输出插入的 span/text 会走这条路早退）。
  if (node.querySelector("button") === null) return;
  syncRowsIn(node);
}

/** 卸载时恢复现场：摘掉我们插的图标、去掉宿主图标上的内联 `display`（不动别的行）。 */
function restoreRows(doc: Document): void {
  for (const glyph of doc.querySelectorAll(`svg[${NAV_GLYPH_ATTR}]`)) {
    const button = glyph.parentElement;
    glyph.remove();
    if (button === null) continue;
    for (const svg of directSvgs(button)) svg.style.display = "";
  }
}

/**
 * 装上垫片：先立即同步一次（浮层可能已经开着），再盯着后续 DOM 变化
 * （设置浮层按需挂载，且宿主随时可能重渲染导航行）。
 *
 * 观察 childList（节点进出）+ `style` 属性：宿主把行内图标换成新节点、或在这颗 svg 上重写
 * 内联样式，都要能把齿轮重新藏回去。属性只过滤 `style`，且回调里对非按钮祖先直接早退，
 * 所以动画/流式输出带来的样式变更只是一次很便宜的 `closest()`。
 *
 * `doc === undefined`（node 单测环境没有 DOM）时是 no-op。返回的 disposer 断开观察器并把
 * 受影响的行恢复原样（宿主齿轮回来、我们的图标摘掉）；重复调用 install 会各自装一个观察器，
 * 正常情况下一个页面只装一次。
 */
export function installAccountNavIcon(doc: Document | undefined): () => void {
  if (doc === undefined) return () => undefined;
  syncRowsIn(doc);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target.nodeType === 1) syncOwner(record.target as Element);
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) syncAdded(node as Element);
      }
    }
  });
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  return () => {
    observer.disconnect();
    restoreRows(doc);
  };
}
