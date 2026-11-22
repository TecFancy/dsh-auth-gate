/**
 * 重置他人密码的表单（重设计 2026-11-16：两阶段提交 + 行式布局）。
 *
 * 阶段由 `useAdminReset` 持有：`editing`（填表）→ `confirm`（确认页）→ `submitting`。
 * 这个组件只负责渲染当前阶段，不自己管状态机。
 *
 * 字段 id 是既有测试钉住的（`#dsh-auth-gate-admin-target/-password/-confirm/-code`），
 * 不能改；动态码是否渲染仍严格沿用 `actorTotpEnabled`。
 */
import { ADMIN_KEYS, type AdminTranslate } from "../lib/admin-copy.ts";
import {
  AdminStatus,
  AdminTextField,
  ADMIN_CODE_HINT_ID,
  ADMIN_STATUS_ID,
  adminFieldId,
} from "./admin-fields.tsx";
import { AdminResetConfirm } from "./admin-reset-confirm.tsx";
import type { AdminField } from "../model/admin-reset.ts";
import { useAdminReset } from "../model/use-admin-reset.ts";
import type { AdminUserRow } from "../../../shared/api/index.ts";
import {
  ActionButton,
  FIELD_CONTROL_STYLE,
  FIELD_LABEL_STYLE,
  FIELD_ROW_STYLE,
  HINT_STYLE,
  ROW_INVALID_INPUT_STYLE,
  ROW_INPUT_STYLE,
} from "../../../shared/ui/index.ts";

export interface AdminResetFormProps {
  t: AdminTranslate;
  users: AdminUserRow[];
  actorName: string;
  actorTotpEnabled: boolean;
  /** A7：成功回调（管理块用它重拉列表刷新徽标）；失败路径不调用。 */
  onReset?: (() => void) | undefined;
}

/** 目标下拉：排除本人（管理面不允许重置自己，契约 §3.6）。 */
function TargetSelect({
  t,
  targets,
  value,
  invalid,
  onChange,
}: {
  t: AdminTranslate;
  targets: AdminUserRow[];
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div style={FIELD_ROW_STYLE}>
      <label htmlFor={adminFieldId("target")} style={FIELD_LABEL_STYLE}>
        {t(ADMIN_KEYS.target)}
      </label>
      <div style={FIELD_CONTROL_STYLE}>
        <select
          id={adminFieldId("target")}
          name="target"
          value={value}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={invalid ? ADMIN_STATUS_ID : undefined}
          style={invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t(ADMIN_KEYS.targetPlaceholder)}</option>
          {targets.map((user) => (
            <option key={user.name} value={user.name}>
              {user.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** 管理重置表单：目标下拉（排除本人）+ 新口令 ×2 + 条件式动态码；成功后清空四字段、不跳转。 */
export function AdminResetForm({
  t,
  users,
  actorName,
  actorTotpEnabled,
  onReset,
}: AdminResetFormProps) {
  const form = useAdminReset({ t, actorTotpEnabled, onReset });
  const targets = users.filter((user) => user.name !== actorName);
  const isInvalid = (field: AdminField): boolean => form.failure?.fields.includes(field) === true;
  const targetInvalid = isInvalid("target");
  const target = form.values.target;

  // 确认阶段：只渲染确认页，不再渲染可编辑字段（避免「以为还能改」）。
  if (form.stage === "confirm" || form.stage === "submitting") {
    return (
      <AdminResetConfirm
        t={t}
        target={target}
        actorName={actorName}
        busy={form.stage === "submitting"}
        onBack={form.back}
        onConfirm={form.confirm}
      />
    );
  }

  // 字段标签带上目标名：三个表单字段同形，读者要能一眼看出在改谁的密码。
  const named = (key: string): string => (target === "" ? t(key) : t(key, { name: target }));
  const fields: { field: AdminField; label: string }[] = [
    { field: "password", label: named(ADMIN_KEYS.targetPassword) },
    { field: "confirm", label: named(ADMIN_KEYS.targetConfirm) },
    ...(actorTotpEnabled ? [{ field: "code" as AdminField, label: t(ADMIN_KEYS.code) }] : []),
  ];
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      noValidate
      onSubmit={form.onSubmit}
      onKeyDown={form.onKeyDown}
      onCompositionStart={form.onCompositionStart}
      onCompositionEnd={form.onCompositionEnd}
    >
      <p style={HINT_STYLE}>{t(ADMIN_KEYS.selfHint)}</p>
      <div>
        <TargetSelect
          t={t}
          targets={targets}
          value={form.values.target}
          invalid={targetInvalid}
          onChange={(value) => form.setValue("target", value)}
        />
        {fields.map((item) => (
          <AdminTextField
            key={item.field}
            field={item.field}
            label={item.label}
            value={form.values[item.field]}
            invalid={isInvalid(item.field)}
            hint={item.field === "code" ? t(ADMIN_KEYS.codeHint) : undefined}
            hintId={item.field === "code" ? ADMIN_CODE_HINT_ID : undefined}
            onChange={(value) => form.setValue(item.field, value)}
          />
        ))}
      </div>
      <p style={HINT_STYLE}>{t(ADMIN_KEYS.policyHint)}</p>
      <AdminStatus failure={form.failure} success={form.success} />
      <ActionButton type="submit">{t(ADMIN_KEYS.submit)}</ActionButton>
    </form>
  );
}
