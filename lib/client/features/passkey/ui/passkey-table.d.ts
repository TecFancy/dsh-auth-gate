/**
 * 通行密钥列表（重设计 2026-11-16：五列压成两列）。
 *
 * 原来固定渲染名称 / 创建时间 / 最近使用 / 备份状态 / 操作五列，在 612px 内容列里
 * 每列只剩 80–190px，长名称和多语言表头互相挤压（评审 F7）。现在：
 * - 第一列是行头（`<th scope="row">`）放名称 + transports；
 * - 名称下面一行 12px 元数据同时呈现创建、最近使用、备份，不再各占一列；
 * - 第二列只有操作。
 *
 * 表格保留 `<caption>`（屏幕阅读器需要知道这是「已注册的通行密钥」），视觉上隐藏。
 * 保持服务端顺序（createdAt 升序），不重排。
 */
import { type AccountTranslate } from "../../../shared/i18n/index.ts";
import type { PasskeySummaryView } from "../model/passkey-form.ts";
/**
 * epoch ms → `YYYY-MM-DD`，按**本地时区**取日期。
 *
 * 不能用 `toISOString().slice(0, 10)`：那是 UTC 日期，东八区用户在 UTC 16:00 之后
 * 创建的凭据会显示成「昨天」。这里用 `Intl.DateTimeFormat` 的 `sv-SE` 区域（它天然
 * 输出 `YYYY-MM-DD`），显式传 `timeZone` 让测试可以钉住时区而不依赖运行环境。
 */
export declare function formatPasskeyDate(value: number, timeZone?: string): string;
export interface PasskeyTableProps {
    t: AccountTranslate;
    passkeys: PasskeySummaryView[];
    /** 正在删除的 idPrefix（null = 没有删除在飞）。 */
    removing: string | null;
    /** 已展开确认区的 idPrefix（null = 没有确认区）。 */
    pendingRemove: string | null;
    /** 点「删除」：只展开确认区，不发请求。 */
    onRequestRemove: (idPrefix: string) => void;
    /** 确认区（由父组件按 pendingRemove 渲染在对应行下方）。 */
    renderConfirm: (passkey: PasskeySummaryView) => React.ReactNode;
}
/** 凭据表：空列表由调用方渲染空态，这里只负责有数据时的表格。 */
export declare function PasskeyTable({ t, passkeys, removing, pendingRemove, onRequestRemove, renderConfirm, }: PasskeyTableProps): import("react").JSX.Element;
//# sourceMappingURL=passkey-table.d.ts.map