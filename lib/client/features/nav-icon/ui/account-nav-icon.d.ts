/** 贴在我们插入的 `<svg>` 上的标记属性：宿主不会写它，重同步时靠它认出自己。 */
export declare const NAV_GLYPH_ATTR = "data-dsh-auth-gate-glyph";
/**
 * 装上垫片：先立即同步一次（浮层可能已经开着），再盯着后续 DOM 变化
 * （设置浮层按需挂载，且宿主随时可能重渲染导航行）。
 *
 * 观察 childList（节点进出）+ `style` 属性：宿主把行内图标换成新节点、或在这颗 svg 上重写
 * 内联样式，都要能把齿轮重新藏回去。`style` 过滤后仍然很吵（React 给任意元素写 style 都会
 * 触发），所以属性回调只处理 **svg 元素**：只有宿主图标上的内联样式与我们有关，其余元素
 * （动画、流式输出的文本容器）直接早退，连 `closest()` 都不跑。
 *
 * `doc === undefined`（node 单测环境没有 DOM）时是 no-op。返回的 disposer 断开观察器并把
 * 受影响的行恢复原样（宿主齿轮回来、我们的图标摘掉）；重复调用 install 会各自装一个观察器，
 * 正常情况下一个页面只装一次。
 */
export declare function installAccountNavIcon(doc: Document | undefined): () => void;
