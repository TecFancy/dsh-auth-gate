import { type AdminTranslate } from "../lib/admin-copy.ts";
export interface AdminResetConfirmProps {
    t: AdminTranslate;
    /** 目标用户名（确认页标题与后果说明都要点名）。 */
    target: string;
    /** 当前登录的管理员（说明「不会改你的账号」）。 */
    actorName: string;
    /** 请求在飞。 */
    busy: boolean;
    onBack: () => void;
    onConfirm: () => void | Promise<void>;
}
/** 确认页：目标 + 后果 + 返回修改 / 确认重置。 */
export declare function AdminResetConfirm({ t, target, actorName, busy, onBack, onConfirm, }: AdminResetConfirmProps): import("react").JSX.Element;
//# sourceMappingURL=admin-reset-confirm.d.ts.map