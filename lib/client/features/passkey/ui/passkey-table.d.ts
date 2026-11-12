/**
 * passkey 列表（M6 PR3）：名称、创建时间、最近使用、备份状态、transports + 每行删除按钮。
 *
 * 只做展示：删除的再认证面板在 `passkey-remove.tsx`，状态机在 `passkey-block.tsx`。
 * 保持服务端顺序（createdAt 升序），不重排。
 */
import { type AccountTranslate } from "../../../shared/i18n/index.ts";
import type { PasskeySummaryView } from "../model/passkey-form.ts";
/** epoch ms → `YYYY-MM-DD`（UTC，locale 无关，测试可断言）。 */
export declare function formatPasskeyDate(value: number): string;
export interface PasskeyTableProps {
    t: AccountTranslate;
    passkeys: PasskeySummaryView[];
    /** 正在删除的 idPrefix（null = 没有删除在飞）。 */
    removing: string | null;
    /** 删除回调：父组件的状态机自己吞掉 Promise（按钮只负责触发）。 */
    onRemove: (idPrefix: string) => void | Promise<void>;
}
/** 凭据表：空列表由调用方渲染空态，这里只负责有数据时的表格。 */
export declare function PasskeyTable({ t, passkeys, removing, onRemove }: PasskeyTableProps): import("react").JSX.Element;
//# sourceMappingURL=passkey-table.d.ts.map