import { type AccountTranslate } from "../../../shared/i18n/index.ts";
import type { PasskeySummaryView } from "../model/passkey-form.ts";
/**
 * epoch ms → `YYYY-MM-DD`，按**本地时区**取日期。
 *
 * 不能用 `toISOString().slice(0, 10)`：那是 UTC 日期，东八区用户在 UTC 16:00 之后
 * 创建的凭据会显示成「昨天」。这里用 `Intl.DateTimeFormat` 的 `sv-SE` 区域（它天然
 * 输出 `YYYY-MM-DD`），显式传 `timeZone` 让测试可以钉住时区而不依赖运行环境。
 *
 * 线上 epoch ms 可能缺失/损坏（NaN、Infinity、超出 Date 范围）：`Intl` 对 Invalid Date
 * 会抛 `RangeError`，不能让一行元数据炸掉整个面板（C7）。这类值渲染成 `-`。
 */
export declare function formatPasskeyDate(value: number, timeZone?: string): string;
export interface PasskeyTableProps {
    t: AccountTranslate;
    passkeys: PasskeySummaryView[];
    /** 正在删除的 idPrefix（null = 没有删除在飞）。 */
    removing: string | null;
    /** 添加在飞：删除按钮置灰，避免两个写动作并发（C6）。 */
    addBusy: boolean;
    /** 已展开确认区的 idPrefix（null = 没有确认区）。 */
    pendingRemove: string | null;
    /** 点「删除」：只展开确认区，不发请求。 */
    onRequestRemove: (idPrefix: string) => void;
    /** 确认区（由父组件按 pendingRemove 渲染在对应行下方）。 */
    renderConfirm: (passkey: PasskeySummaryView) => React.ReactNode;
}
/** 凭据表：空列表由调用方渲染空态，这里只负责有数据时的表格。 */
export declare function PasskeyTable({ t, passkeys, removing, addBusy, pendingRemove, onRequestRemove, renderConfirm, }: PasskeyTableProps): import("react").JSX.Element;
