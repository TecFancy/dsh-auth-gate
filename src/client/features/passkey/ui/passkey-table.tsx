/**
 * 通行密钥列表（重设计 2026-11-16：五列压成两列）。
 *
 * 原来固定渲染名称 / 创建时间 / 最近使用 / 备份状态 / 操作五列，在 612px 内容列里
 * 每列只剩 80–190px，长名称和多语言表头互相挤压（评审 F7）。现在：
 * - 第一列是行头（`<th scope="row">`）放名称 + transports；
 * - 名称下面一行 12px 元数据同时呈现创建、最近使用、备份，不再各占一列；
 * - 第二列只有操作。
 *
 * 表格保留 `<caption>`（屏幕阅读器需要知道这是「已注册的通行密钥」），视觉上隐藏。
 * 保持服务端顺序（createdAt 升序），不重排。
 */
import { Fragment } from "react";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ActionButton,
  ADMIN_TABLE_STYLE,
  ADMIN_TD_STYLE,
  ADMIN_TH_STYLE,
  CREDENTIAL_META_STYLE,
  HINT_STYLE,
  VISUALLY_HIDDEN_STYLE,
} from "../../../shared/ui/index.ts";
import type { PasskeySummaryView } from "../model/passkey-form.ts";

/**
 * epoch ms → `YYYY-MM-DD`，按**本地时区**取日期。
 *
 * 不能用 `toISOString().slice(0, 10)`：那是 UTC 日期，东八区用户在 UTC 16:00 之后
 * 创建的凭据会显示成「昨天」。这里用 `Intl.DateTimeFormat` 的 `sv-SE` 区域（它天然
 * 输出 `YYYY-MM-DD`），显式传 `timeZone` 让测试可以钉住时区而不依赖运行环境。
 *
 * 线上 epoch ms 可能缺失/损坏（NaN、Infinity、超出 Date 范围）：`Intl` 对 Invalid Date
 * 会抛 `RangeError`，不能让一行元数据炸掉整个面板（C7）。这类值渲染成 `-`。
 */
export function formatPasskeyDate(value: number, timeZone?: string): string {
  if (!Number.isFinite(value)) return "-";
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  };
  try {
    return new Intl.DateTimeFormat("sv-SE", options).format(new Date(value));
  } catch {
    return "-";
  }
}

/** 备份状态徽标：已备份 > 可同步 > 仅本设备（互斥，按信息量从强到弱）。 */
function backupText(passkey: PasskeySummaryView, t: AccountTranslate): string {
  if (passkey.backupState) return t(PASSKEY_KEYS.backupState);
  if (passkey.backupEligible) return t(PASSKEY_KEYS.backupEligible);
  return t(PASSKEY_KEYS.deviceBound);
}

/** 一行凭据的元数据：创建 / 最近使用 / 备份，用 `·` 分隔。 */
function metaText(passkey: PasskeySummaryView, t: AccountTranslate): string {
  const created = t(PASSKEY_KEYS.colCreated);
  const lastUsed = t(PASSKEY_KEYS.colLastUsed);
  const backup = t(PASSKEY_KEYS.colBackup);
  const used =
    passkey.lastUsedAt === 0 ? t(PASSKEY_KEYS.neverUsed) : formatPasskeyDate(passkey.lastUsedAt);
  return `${created} ${formatPasskeyDate(passkey.createdAt)} · ${lastUsed} ${used} · ${backup} ${backupText(passkey, t)}`;
}

export interface PasskeyTableProps {
  t: AccountTranslate;
  passkeys: PasskeySummaryView[];
  /** 正在删除的 idPrefix（null = 没有删除在飞）。 */
  removing: string | null;
  /** 添加在飞：删除按钮置灰，避免两个写动作并发（C6）。 */
  addBusy: boolean;
  /** 已展开确认区的 idPrefix（null = 没有确认区）。 */
  pendingRemove: string | null;
  /** 点「删除」：只展开确认区，不发请求。 */
  onRequestRemove: (idPrefix: string) => void;
  /** 确认区（由父组件按 pendingRemove 渲染在对应行下方）。 */
  renderConfirm: (passkey: PasskeySummaryView) => React.ReactNode;
}

/** 凭据表：空列表由调用方渲染空态，这里只负责有数据时的表格。 */
export function PasskeyTable({
  t,
  passkeys,
  removing,
  addBusy,
  pendingRemove,
  onRequestRemove,
  renderConfirm,
}: PasskeyTableProps) {
  return (
    <table style={ADMIN_TABLE_STYLE}>
      <caption style={VISUALLY_HIDDEN_STYLE}>{t(PASSKEY_KEYS.tableCaption)}</caption>
      <thead>
        <tr>
          <th style={ADMIN_TH_STYLE}>{t(PASSKEY_KEYS.colLabel)}</th>
          <th style={{ ...ADMIN_TH_STYLE, textAlign: "right" }}>{t(PASSKEY_KEYS.colActions)}</th>
        </tr>
      </thead>
      <tbody>
        {passkeys.map((passkey) => {
          const busy = removing === passkey.idPrefix;
          const confirming = pendingRemove === passkey.idPrefix;
          return (
            <Fragment key={passkey.idPrefix}>
              <tr>
                <th scope="row" style={{ ...ADMIN_TD_STYLE, textAlign: "left", fontWeight: 400 }}>
                  <span>{passkey.label}</span>
                  {passkey.transports.length === 0 ? null : (
                    <span style={HINT_STYLE}> {passkey.transports.join(", ")}</span>
                  )}
                  <div style={CREDENTIAL_META_STYLE}>{metaText(passkey, t)}</div>
                </th>
                <td style={{ ...ADMIN_TD_STYLE, textAlign: "right", verticalAlign: "top" }}>
                  <ActionButton
                    variant="danger"
                    busy={busy}
                    disabled={addBusy}
                    aria-expanded={confirming}
                    onClick={() => onRequestRemove(passkey.idPrefix)}
                  >
                    {busy ? t(PASSKEY_KEYS.removing) : t(PASSKEY_KEYS.remove)}
                  </ActionButton>
                </td>
              </tr>
              {confirming ? (
                // 确认区独立成行：表单/输入不能塞在行头 `<th>` 里（C6）。
                <tr>
                  <td colSpan={2} style={ADMIN_TD_STYLE}>
                    {renderConfirm(passkey)}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
