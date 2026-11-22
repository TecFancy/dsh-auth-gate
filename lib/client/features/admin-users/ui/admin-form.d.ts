/**
 * 重置他人密码的表单（重设计 2026-11-16：两阶段提交 + 行式布局）。
 *
 * 阶段由 `useAdminReset` 持有：`editing`（填表）→ `confirm`（确认页）→ `submitting`。
 * 这个组件只负责渲染当前阶段，不自己管状态机。
 *
 * 字段 id 是既有测试钉住的（`#dsh-auth-gate-admin-target/-password/-confirm/-code`），
 * 不能改；动态码是否渲染仍严格沿用 `actorTotpEnabled`。
 */
import { type AdminTranslate } from "../lib/admin-copy.ts";
import type { AdminUserRow } from "../../../shared/api/index.ts";
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
