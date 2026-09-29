import { useEffect, useState } from "react";
import { fetchAdminUsers } from "./admin-api.ts";
import { ADMIN_KEYS, type AdminTranslate } from "./admin-copy.ts";
import { AdminResetForm } from "./admin-form.tsx";
import { ADMIN_STATUS_ID } from "./admin-fields.tsx";
import type { AdminUserRow } from "./admin-types.ts";
import {
  ADMIN_BADGE_STYLE,
  ADMIN_BLOCK_STYLE,
  ADMIN_TABLE_STYLE,
  ADMIN_TD_STYLE,
  ADMIN_TH_STYLE,
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  TITLE_STYLE,
} from "./account-styles.ts";

const TITLE_ID = "dsh-auth-gate-admin-title";

/**
 * 列表状态（评审修正 A2）：`denied`（403 非 admin / 受限）静默返回 null；
 * `unauthorized`（401 登录态已死）必须提示，不能静默消失；
 * `failure`（503/网络/解析）提示不可用。
 */
type UsersState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unauthorized" }
  | { kind: "failure" }
  | { kind: "ok"; users: AdminUserRow[] };

/**
 * 挂载后拉一次列表（契约 §3.4：非 admin 根本不会挂载本组件，这里不判断角色）；
 * `reload` 供 A7 成功后静默刷新徽标：刷新失败**不改行**（首拉才降级），同一 abort 规则。
 */
function useAdminUsers(): { state: UsersState; reload: () => void } {
  const [state, setState] = useState<UsersState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const first = attempt === 0;
    void fetchAdminUsers(controller.signal)
      .then((result) => {
        if (!live || result.kind === "aborted") return;
        if (result.kind === "ok") setState({ kind: "ok", users: result.users });
        else if (first) setState({ kind: result.kind });
      })
      .catch(() => {
        if (live && first) setState({ kind: "failure" });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);
  return { state, reload: () => setAttempt((value) => value + 1) };
}

/** 角色文案：`admin`/`user` 走词典；**未知取值原样渲染**，不新增键（A9）。 */
function roleText(role: string, t: AdminTranslate): string {
  if (role === "admin") return t(ADMIN_KEYS.roleAdmin);
  if (role === "user") return t(ADMIN_KEYS.roleUser);
  return String(role);
}

/** 状态徽标**互斥**，优先级 disabled > mustChangePassword > ok（A9）。 */
function stateText(user: AdminUserRow, t: AdminTranslate): string {
  if (user.disabled) return t(ADMIN_KEYS.stateDisabled);
  return user.mustChangePassword ? t(ADMIN_KEYS.stateMustChange) : t(ADMIN_KEYS.stateOk);
}

/** 只读用户表：**保持服务端顺序**，不做任何重排（契约 §1.2 / §3.5）。 */
function AdminUsersTable({
  t,
  users,
  actorName,
}: {
  t: AdminTranslate;
  users: AdminUserRow[];
  actorName: string;
}) {
  return (
    <table style={ADMIN_TABLE_STYLE}>
      <thead>
        <tr>
          <th style={ADMIN_TH_STYLE}>{t(ADMIN_KEYS.colUser)}</th>
          <th style={ADMIN_TH_STYLE}>{t(ADMIN_KEYS.colRole)}</th>
          <th style={ADMIN_TH_STYLE}>{t(ADMIN_KEYS.colState)}</th>
          <th style={ADMIN_TH_STYLE}>{t(ADMIN_KEYS.colTotp)}</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.name}>
            <td style={ADMIN_TD_STYLE}>
              <span>{user.name}</span>
              {user.name === actorName ? (
                <span style={ADMIN_BADGE_STYLE}>{t(ADMIN_KEYS.you)}</span>
              ) : null}
            </td>
            <td style={ADMIN_TD_STYLE}>{roleText(user.role, t)}</td>
            <td style={ADMIN_TD_STYLE}>
              <span style={ADMIN_BADGE_STYLE}>{stateText(user, t)}</span>
            </td>
            <td style={ADMIN_TD_STYLE}>
              <span style={ADMIN_BADGE_STYLE}>
                {user.totpEnabled ? t(ADMIN_KEYS.totpOn) : t(ADMIN_KEYS.totpOff)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 提示态（loading / unauthorized / unavailable）：同一条 aria-live 播报位。 */
function AdminNotice({ text, error }: { text: string; error?: boolean }) {
  return (
    <p
      id={ADMIN_STATUS_ID}
      role="status"
      aria-live="polite"
      style={error === true ? ERROR_TEXT_STYLE : HINT_STYLE}
    >
      {text}
    </p>
  );
}

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
export function AdminUsersBlock({ t, actorName, actorTotpEnabled }: AdminUsersBlockProps) {
  const { state, reload } = useAdminUsers();
  if (state.kind === "loading") return <AdminNotice text={t(ADMIN_KEYS.loading)} />;
  if (state.kind === "denied") return null;
  if (state.kind === "unauthorized") {
    return <AdminNotice text={t(ADMIN_KEYS.unauthorized)} error />;
  }
  if (state.kind === "failure") return <AdminNotice text={t(ADMIN_KEYS.unavailable)} error />;
  const targets = state.users.filter((user) => user.name !== actorName);
  return (
    <section style={ADMIN_BLOCK_STYLE} aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} style={TITLE_STYLE}>
        {t(ADMIN_KEYS.title)}
      </h3>
      <p style={HINT_STYLE}>{t(ADMIN_KEYS.intro)}</p>
      <AdminUsersTable t={t} users={state.users} actorName={actorName} />
      {targets.length === 0 ? (
        <p id={ADMIN_STATUS_ID} style={HINT_STYLE}>
          {t(ADMIN_KEYS.empty)}
        </p>
      ) : (
        <AdminResetForm
          t={t}
          users={state.users}
          actorName={actorName}
          actorTotpEnabled={actorTotpEnabled}
          onReset={reload}
        />
      )}
    </section>
  );
}
