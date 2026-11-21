/**
 * 管理块（重设计 2026-11-16：固定外壳 + 重置入口默认收起）。
 *
 * 两处结构变化：
 * 1. **异步状态不再丢掉标题**。原来 loading / 401 / failure 时提前返回一条裸 Notice，
 *    「用户管理」标题和表格整体消失，状态变化会让页面跳动（评审 F8）。现在外壳
 *    （标题 + 说明）恒定渲染，只有内容区换状态。
 * 2. **重置表单默认收起**。它是低频且危险的动作，常驻展开会把用户表推下去；点
 *    「重置他人密码」就地展开，取消后焦点回触发按钮。
 */
import { useEffect, useRef, useState } from "react";
import {
  fetchAdminUsers,
  AdminResetForm,
  ADMIN_STATUS_ID,
} from "../../../features/admin-users/index.ts";
import { ADMIN_KEYS, type AdminTranslate } from "../../../features/admin-users/index.ts";
import type { AdminUserRow } from "../../../shared/api/index.ts";
import {
  ActionButton,
  ADMIN_BADGE_STYLE,
  ADMIN_TABLE_STYLE,
  ADMIN_TD_STYLE,
  ADMIN_TH_STYLE,
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  SECTION_ACTIONS_STYLE,
  SECTION_HEADING_STYLE,
  TITLE_STYLE,
  VISUALLY_HIDDEN_STYLE,
} from "../../../shared/ui/index.ts";

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
  | { kind: "ok"; users: AdminUserRow[]; refreshFailed?: boolean };

/**
 * 挂载后拉一次列表（契约 §3.4：非 admin 根本不会挂载本组件，这里不判断角色）；
 * `reload` 供 A7 成功后重拉徽标。刷新失败也落到 failure 态（C3）：静默保留旧数据会让
 * 「成功」播报与过期列表同屏，重试按钮也无事可做。同一 abort 规则。
 */
function useAdminUsers(): { state: UsersState; reload: () => void } {
  const [state, setState] = useState<UsersState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void fetchAdminUsers(controller.signal)
      .then((result) => {
        if (!live || result.kind === "aborted") return;
        if (result.kind === "ok") setState({ kind: "ok", users: result.users });
        else if (result.kind === "denied" || result.kind === "unauthorized") {
          setState({ kind: result.kind });
        } else {
          // 刷新失败：保留上一份可用列表与成功播报，只在旁边挂一条错误（C3）。
          setState((previous) =>
            previous.kind === "ok" ? { ...previous, refreshFailed: true } : { kind: "failure" },
          );
        }
      })
      .catch(() => {
        if (!live) return;
        setState((previous) =>
          previous.kind === "ok" ? { ...previous, refreshFailed: true } : { kind: "failure" },
        );
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
      <caption style={VISUALLY_HIDDEN_STYLE}>{t(ADMIN_KEYS.tableCaption)}</caption>
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

/** 内容区：按列表状态切换（外壳恒定渲染，只有这里换）。 */
function AdminBody({
  t,
  state,
  actorName,
  actorTotpEnabled,
  resetting,
  onRetry,
  onReset,
  onCloseReset,
}: {
  t: AdminTranslate;
  state: UsersState;
  actorName: string;
  actorTotpEnabled: boolean;
  resetting: boolean;
  onRetry: () => void;
  onReset: () => void;
  onCloseReset: () => void;
}) {
  if (state.kind === "loading") return <AdminNotice text={t(ADMIN_KEYS.loading)} />;
  if (state.kind === "unauthorized") {
    return <AdminNotice text={t(ADMIN_KEYS.unauthorized)} error />;
  }
  if (state.kind === "failure") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AdminNotice text={t(ADMIN_KEYS.unavailable)} error />
        <ActionButton variant="ghost" onClick={onRetry}>
          {t(ADMIN_KEYS.retry)}
        </ActionButton>
      </div>
    );
  }
  if (state.kind !== "ok") return null;
  const targets = state.users.filter((user) => user.name !== actorName);
  return (
    <>
      {state.refreshFailed === true ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AdminNotice text={t(ADMIN_KEYS.unavailable)} error />
          <ActionButton variant="ghost" onClick={onRetry}>
            {t(ADMIN_KEYS.retry)}
          </ActionButton>
        </div>
      ) : null}
      <AdminUsersTable t={t} users={state.users} actorName={actorName} />
      {targets.length === 0 ? (
        <p id={ADMIN_STATUS_ID} style={HINT_STYLE}>
          {t(ADMIN_KEYS.empty)}
        </p>
      ) : null}
      {resetting ? (
        <>
          <AdminResetForm
            t={t}
            users={state.users}
            actorName={actorName}
            actorTotpEnabled={actorTotpEnabled}
            onReset={onReset}
          />
          <div>
            <ActionButton variant="ghost" onClick={onCloseReset}>
              {t(ADMIN_KEYS.cancel)}
            </ActionButton>
          </div>
        </>
      ) : null}
    </>
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
 * 管理块（契约 §3 / A2）：外壳恒定渲染，内容区按状态切换。
 * 「只有本人」时显示 `admin.empty` 且**不渲染重置入口**（§3.6）。
 */
export function AdminUsersBlock({ t, actorName, actorTotpEnabled }: AdminUsersBlockProps) {
  const { state, reload } = useAdminUsers();
  const [resetting, setResetting] = useState(false);
  const resetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef(false);

  /** 收起重置表单并把焦点还给触发按钮（等渲染完成再还）。 */
  const closeReset = (): void => {
    returnFocusRef.current = true;
    setResetting(false);
  };

  useEffect(() => {
    if (resetting || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    resetTriggerRef.current?.focus();
  }, [resetting]);

  // denied：整块静默不渲染（这张 cookie 不是 admin / 不是 full 会话）。
  if (state.kind === "denied") return null;

  const targets = state.kind === "ok" ? state.users.filter((user) => user.name !== actorName) : [];
  const canReset = state.kind === "ok" && targets.length > 0;

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      aria-labelledby={TITLE_ID}
    >
      <div style={SECTION_HEADING_STYLE}>
        <h3 id={TITLE_ID} style={TITLE_STYLE}>
          {t(ADMIN_KEYS.title)}
        </h3>
        <div style={SECTION_ACTIONS_STYLE}>
          {canReset && !resetting ? (
            <ActionButton ref={resetTriggerRef} variant="ghost" onClick={() => setResetting(true)}>
              {t(ADMIN_KEYS.resetOpen)}
            </ActionButton>
          ) : null}
        </div>
      </div>
      <p style={HINT_STYLE}>{t(ADMIN_KEYS.intro)}</p>
      <AdminBody
        t={t}
        state={state}
        actorName={actorName}
        actorTotpEnabled={actorTotpEnabled}
        resetting={resetting}
        onRetry={reload}
        onReset={reload}
        onCloseReset={closeReset}
      />
    </section>
  );
}
