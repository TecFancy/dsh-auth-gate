import type { AdminFailureView, AdminField } from "../model/admin-reset.ts";
/** 状态播报位：aria-live 落点，也是错误字段 aria-describedby 的目标。 */
export declare const ADMIN_STATUS_ID = "dsh-auth-gate-admin-status";
export declare const ADMIN_CODE_HINT_ID = "dsh-auth-gate-admin-code-hint";
export declare function adminFieldId(field: AdminField): string;
/** 成功视图（A8）：`warning` = `sessionsRevoked:false`，是安全失败，走 alert + 错误色。 */
export interface AdminSuccessView {
    text: string;
    warning: boolean;
}
/** 带 label / 错误描边 / aria 关联的输入行（与自助面同范式，id 换管理块前缀）。 */
export declare function AdminTextField({ field, label, value, invalid, onChange, hint, hintId, }: {
    field: AdminField;
    label: string;
    value: string;
    invalid: boolean;
    onChange: (value: string) => void;
    hint?: string | undefined;
    hintId?: string | undefined;
}): import("react").JSX.Element;
/**
 * 状态区：失败消息 + 已翻译规则列表 + 就地成功/警告文案（契约 §3.8 / A8）。
 *
 * 播报位先渲染空、再由 effect 填内容（C4）：这块会和编辑区一起重新挂载（确认页 → 编辑页），
 * 节点插入时就带着内容的话，aria-live 不会触发播报。
 */
export declare function AdminStatus({ failure, success, }: {
    failure: AdminFailureView | null;
    success: AdminSuccessView | null;
}): import("react").JSX.Element;
