import { type AdminTranslate } from "./admin-copy.ts";
export interface AdminUsersBlockProps {
    /** 槽位注入的翻译 seat（含 ADMIN 词典分片）。 */
    t: AdminTranslate;
    /** 当前登录用户名（status.name）：用于「本人」标记与下拉排除。 */
    actorName: string;
    /** 当前账号是否启用两步验证：决定 `code` 输入框是否渲染（契约 §3.7）。 */
    actorTotpEnabled: boolean;
}
/**
 * 管理块（契约 §3 / A2）：loading → denied 静默 null → unauthorized / failure 提示
 * → ok 列表 + 表单。「只有本人」时显示 `admin.empty` 且**不渲染表单**（§3.6）。
 */
export declare function AdminUsersBlock({ t, actorName, actorTotpEnabled }: AdminUsersBlockProps): import("react").JSX.Element | null;
//# sourceMappingURL=admin-block.d.ts.map