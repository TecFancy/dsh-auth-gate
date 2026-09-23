/**
 * 自设计图标（P1.1 / D24）：「盾 + 钥匙孔」，16px outline，规格对齐宿主图标
 * （`fill:none` / `stroke:currentColor` / `stroke-width:1.5` / 圆角线端）。
 *
 * 为什么自设计：宿主 `settings.section` 只投影 `id`/`order`/`label`，导航图标由
 * `dsh-client-ui-settings-general` 的 `navIcon(id)` 硬编码 if 链决定（0.1.5-rc.2 与
 * 0.1.7-alpha.2 都如此，且没有 `icon` 选项）。插件侧没有官方挂载点，也**不去改宿主的
 * nav DOM**（与宿主 React 抢树，评审已否掉），所以图标只画在我们自己的内容区标题行
 * （见 `account-form.tsx` 的 AccountIcon）。
 *
 * 路径数据与 `docs/demo/account-security.svg` 同源，由 `account-icon.test.ts` 逐条比对；
 * 改一处必须同步另一处。
 */
export const ACCOUNT_ICON_VIEW_BOX = "0 0 16 16";

/** 图标路径（两个 `d`：盾牌外框 + 钥匙孔圆与柄）。 */
export const ACCOUNT_ICON_PATHS: readonly string[] = [
  "M8 1.7 13.1 3.55V7.9c0 3.05-2.08 5.42-5.1 6.4-3.02-.98-5.1-3.35-5.1-6.4V3.55Z",
  "M9.3 7a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 1 1 2.6 0M8 8.3v2.1",
];
