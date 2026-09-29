import { type AdminTranslate } from "./admin-copy.ts";
import { type AdminUserRow } from "./admin-types.ts";
export interface AdminResetFormProps {
    t: AdminTranslate;
    users: AdminUserRow[];
    actorName: string;
    actorTotpEnabled: boolean;
    /** A7：成功回调（管理块用它重拉列表刷新徽标）；失败路径不调用。 */
    onReset?: (() => void) | undefined;
}
/** 管理重置表单：目标下拉（排除本人）+ 新口令 ×2 + 条件式动态码；成功后清空四字段、不跳转。 */
export declare function AdminResetForm({ t, users, actorName, actorTotpEnabled, onReset, }: AdminResetFormProps): import("react").JSX.Element;
//# sourceMappingURL=admin-form.d.ts.map