/**
 * passkey 列表（M6 PR3）：名称、创建时间、最近使用、备份状态、transports + 每行删除按钮。
 *
 * 只做展示：删除的再认证面板在 `passkey-remove.tsx`，状态机在 `passkey-block.tsx`。
 * 保持服务端顺序（createdAt 升序），不重排。
 */
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ADMIN_BADGE_STYLE,
  ADMIN_TABLE_STYLE,
  ADMIN_TD_STYLE,
  ADMIN_TH_STYLE,
  BUTTON_BUSY_STYLE,
  BUTTON_STYLE,
  HINT_STYLE,
} from "../../../shared/ui/index.ts";
import type { PasskeySummaryView } from "../model/passkey-form.ts";

/** epoch ms → `YYYY-MM-DD`（UTC，locale 无关，测试可断言）。 */
export function formatPasskeyDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** 备份状态徽标：已备份 > 可同步 > 仅本设备（互斥，按信息量从强到弱）。 */
function backupText(passkey: PasskeySummaryView, t: AccountTranslate): string {
  if (passkey.backupState) return t(PASSKEY_KEYS.backupState);
  if (passkey.backupEligible) return t(PASSKEY_KEYS.backupEligible);
  return t(PASSKEY_KEYS.deviceBound);
}

/** 行内删除按钮：`busy` 时禁用（同一时刻只允许一个删除在飞）。 */
function RemoveButton({
  t,
  busy,
  onClick,
}: {
  t: AccountTranslate;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      style={busy ? BUTTON_BUSY_STYLE : BUTTON_STYLE}
      onClick={onClick}
    >
      {busy ? t(PASSKEY_KEYS.removing) : t(PASSKEY_KEYS.remove)}
    </button>
  );
}

export interface PasskeyTableProps {
  t: AccountTranslate;
  passkeys: PasskeySummaryView[];
  /** 正在删除的 idPrefix（null = 没有删除在飞）。 */
  removing: string | null;
  /** 删除回调：父组件的状态机自己吞掉 Promise（按钮只负责触发）。 */
  onRemove: (idPrefix: string) => void | Promise<void>;
}

/** 凭据表：空列表由调用方渲染空态，这里只负责有数据时的表格。 */
export function PasskeyTable({ t, passkeys, removing, onRemove }: PasskeyTableProps) {
  return (
    <table style={ADMIN_TABLE_STYLE}>
      <thead>
        <tr>
          <th style={ADMIN_TH_STYLE}>{t(PASSKEY_KEYS.colLabel)}</th>
          <th style={ADMIN_TH_STYLE}>{t(PASSKEY_KEYS.colCreated)}</th>
          <th style={ADMIN_TH_STYLE}>{t(PASSKEY_KEYS.colLastUsed)}</th>
          <th style={ADMIN_TH_STYLE}>{t(PASSKEY_KEYS.colBackup)}</th>
          <th style={ADMIN_TH_STYLE}>{t(PASSKEY_KEYS.colActions)}</th>
        </tr>
      </thead>
      <tbody>
        {passkeys.map((passkey) => (
          <tr key={passkey.idPrefix}>
            <td style={ADMIN_TD_STYLE}>
              <span>{passkey.label}</span>
              {passkey.transports.length === 0 ? null : (
                <span style={HINT_STYLE}> {passkey.transports.join(", ")}</span>
              )}
            </td>
            <td style={ADMIN_TD_STYLE}>{formatPasskeyDate(passkey.createdAt)}</td>
            <td style={ADMIN_TD_STYLE}>
              {passkey.lastUsedAt === 0
                ? t(PASSKEY_KEYS.neverUsed)
                : formatPasskeyDate(passkey.lastUsedAt)}
            </td>
            <td style={ADMIN_TD_STYLE}>
              <span style={ADMIN_BADGE_STYLE}>{backupText(passkey, t)}</span>
            </td>
            <td style={ADMIN_TD_STYLE}>
              <RemoveButton
                t={t}
                busy={removing === passkey.idPrefix}
                onClick={() => {
                  void onRemove(passkey.idPrefix);
                }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
