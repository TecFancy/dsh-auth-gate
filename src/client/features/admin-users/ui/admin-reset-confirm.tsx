/**
 * 重置他人密码的确认页（重设计 2026-11-16）。
 *
 * 为什么需要它：原来选错用户名直接执行，旧密码立即失效 + 会话吊销，是管理面最贵的
 * 可预防错误。确认页把「对谁做什么」和「不可逆后果」摆在同一个视野里，并要求显式点击。
 *
 * 安全细节：
 * - 安全动作（返回修改）在左，危险动作（确认重置）在右，避免双击同坐标完成破坏；
 * - 打开时焦点落在「返回修改」，不是危险按钮；
 * - 确认阶段按 Enter 不触发危险动作（Enter 只在编辑阶段推进到确认页）。
 */
import { useEffect, useRef } from "react";
import { ADMIN_KEYS, type AdminTranslate } from "../lib/admin-copy.ts";
import {
  ActionButton,
  CONFIRM_ACTIONS_STYLE,
  CONFIRM_PANEL_STYLE,
  CONFIRM_TITLE_STYLE,
  CONFIRM_WARNING_STYLE,
} from "../../../shared/ui/index.ts";

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
export function AdminResetConfirm({
  t,
  target,
  actorName,
  busy,
  onBack,
  onConfirm,
}: AdminResetConfirmProps) {
  const backRef = useRef<HTMLButtonElement | null>(null);

  // 打开即聚焦安全动作：键盘用户不会一按 Enter 就执行危险操作。
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  return (
    <div
      style={CONFIRM_PANEL_STYLE}
      role="group"
      aria-labelledby="dsh-auth-gate-admin-confirm-title"
    >
      <h4 id="dsh-auth-gate-admin-confirm-title" style={CONFIRM_TITLE_STYLE}>
        {t(ADMIN_KEYS.confirmTitle, { name: target })}
      </h4>
      <p style={CONFIRM_WARNING_STYLE}>
        {t(ADMIN_KEYS.resetContext, { name: target, actor: actorName })}
      </p>
      <p style={CONFIRM_WARNING_STYLE}>{t(ADMIN_KEYS.confirmWarning, { name: target })}</p>
      <div style={CONFIRM_ACTIONS_STYLE}>
        <ActionButton ref={backRef} variant="ghost" onClick={onBack} disabled={busy}>
          {t(ADMIN_KEYS.back)}
        </ActionButton>
        <ActionButton variant="danger" busy={busy} onClick={() => void onConfirm()}>
          {busy
            ? t(ADMIN_KEYS.confirming, { name: target })
            : t(ADMIN_KEYS.confirmSubmit, { name: target })}
        </ActionButton>
      </div>
    </div>
  );
}
