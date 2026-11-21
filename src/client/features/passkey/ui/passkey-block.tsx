/**
 * 「通行密钥」区块（重设计 2026-11-16）。
 *
 * 结构：标题行（标题 + 数量徽标 + 添加按钮）+ 说明 + 列表（或空态）+ 状态播报位
 * + 按需展开的添加表单。添加与删除都默认收起：这两个动作一年用不了几次，常驻展开
 * 会把改密主任务挤出首屏（评审：低频表单不该和主任务抢空间）。
 *
 * 特性检测：`window.PublicKeyCredential` 不存在时**隐藏添加按钮**（列表照常显示，
 * 用户仍能看到/删除已有凭据）；无 JS 时整块不渲染（React 组件，本来就需要 JS）。
 *
 * 无权限（403 受限会话）时**不渲染添加与删除**：列表被禁止不代表添加被允许，
 * 让用户填一堆注定 403 的秘密信息是更糟的体验（评审 F5）。
 */
import { useEffect, useRef, useState } from "react";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ActionButton,
  ADMIN_BLOCK_STYLE,
  ADMIN_BADGE_STYLE,
  EMPTY_STATE_STYLE,
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  SECTION_ACTIONS_STYLE,
  SECTION_HEADING_STYLE,
  TITLE_STYLE,
} from "../../../shared/ui/index.ts";
import { isPasskeySupported } from "../api/passkey-codec.ts";
import { PasskeyAddForm } from "./passkey-add-form.tsx";
import { PasskeyStatus } from "./passkey-fields.tsx";
import { PasskeyRemoveForm } from "./passkey-remove-form.tsx";
import { PasskeyTable } from "./passkey-table.tsx";
import { usePasskeyActions } from "../model/use-passkey-actions.ts";
import { usePasskeyList } from "../model/use-passkey-list.ts";

const TITLE_ID = "dsh-auth-gate-passkey-title";

export interface PasskeyBlockProps {
  /** 槽位注入的翻译 seat（含 `account.passkey.*` 键）。 */
  t: AccountTranslate;
  /** 当前账号是否开启两步验证：只影响动态码框的提示文案。 */
  totpEnabled?: boolean | undefined;
}

/** 列表区：loading / 静默（受限会话）/ 错误 / 空态 / 表格。 */
function PasskeyListArea({
  t,
  state,
  removing,
  addBusy,
  pendingRemove,
  onRequestRemove,
  renderConfirm,
  onRetry,
}: {
  t: AccountTranslate;
  state: ReturnType<typeof usePasskeyList>["state"];
  removing: string | null;
  addBusy: boolean;
  pendingRemove: string | null;
  onRequestRemove: (idPrefix: string) => void;
  renderConfirm: (
    passkey: import("../model/passkey-form.ts").PasskeySummaryView,
  ) => React.ReactNode;
  onRetry: () => void;
}) {
  if (state.kind === "loading") return <p style={HINT_STYLE}>{t(PASSKEY_KEYS.loading)}</p>;
  // 受限会话（403）静默：这张 cookie 本来就不该看到管理面，与 admin 块同一策略。
  if (state.kind === "forbidden") return null;
  if (state.kind === "unauthorized") {
    return <p style={ERROR_TEXT_STYLE}>{t(PASSKEY_KEYS.unauthorized)}</p>;
  }
  if (state.kind === "failure") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <p style={ERROR_TEXT_STYLE}>{t(PASSKEY_KEYS.unavailable)}</p>
        <ActionButton variant="ghost" onClick={onRetry}>
          {t(PASSKEY_KEYS.retry)}
        </ActionButton>
      </div>
    );
  }
  if (state.passkeys.length === 0) return null;
  return (
    <>
      {state.refreshFailed === true ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p style={ERROR_TEXT_STYLE}>{t(PASSKEY_KEYS.unavailable)}</p>
          <ActionButton variant="ghost" onClick={onRetry}>
            {t(PASSKEY_KEYS.retry)}
          </ActionButton>
        </div>
      ) : null}
      <PasskeyTable
        t={t}
        passkeys={state.passkeys}
        removing={removing}
        addBusy={addBusy}
        pendingRemove={pendingRemove}
        onRequestRemove={onRequestRemove}
        renderConfirm={renderConfirm}
      />
    </>
  );
}

/** 列表主体：空态 / 加载 / 错误 / 表格（含行内删除确认区）。 */
function PasskeyBody({
  t,
  state,
  actions,
  totpEnabled,
  onRetry,
}: {
  t: AccountTranslate;
  state: ReturnType<typeof usePasskeyList>["state"];
  actions: ReturnType<typeof usePasskeyActions>;
  totpEnabled?: boolean | undefined;
  onRetry: () => void;
}) {
  if (state.kind === "ok" && state.passkeys.length === 0) {
    return (
      <div style={EMPTY_STATE_STYLE}>
        <p style={HINT_STYLE}>{t(PASSKEY_KEYS.empty)}</p>
      </div>
    );
  }
  return (
    <PasskeyListArea
      t={t}
      state={state}
      removing={actions.removing}
      addBusy={actions.adding}
      pendingRemove={actions.pendingRemove}
      onRequestRemove={actions.requestRemove}
      onRetry={onRetry}
      renderConfirm={(passkey) => (
        <PasskeyRemoveForm
          t={t}
          label={passkey.label}
          values={actions.reauth}
          invalid={actions.invalid}
          busy={actions.removing === passkey.idPrefix}
          totpEnabled={totpEnabled}
          onChange={actions.setReauthValue}
          onCancel={actions.cancelRemove}
          onConfirm={actions.confirmRemove}
        />
      )}
    />
  );
}

/**
 * 通行密钥区块：列表 + 添加/删除。
 *
 * `supported` 在渲染期算一次（特性检测是纯读操作），不支持时只隐藏添加入口，
 * 列表与删除仍可用。
 */
export function PasskeyBlock({ t, totpEnabled }: PasskeyBlockProps) {
  const { state, reload } = usePasskeyList();
  const actions = usePasskeyActions(t, reload);
  const supported = isPasskeySupported();
  const [adding, setAdding] = useState(false);
  const addTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** 收起表单后要把焦点还给触发按钮；等渲染完成（按钮重新出现）再还。 */
  const returnFocusRef = useRef(false);

  const count = state.kind === "ok" ? state.passkeys.length : null;
  const isEmpty = state.kind === "ok" && state.passkeys.length === 0;
  const canMutate = state.kind === "ok";

  /**
   * 收起添加表单并把焦点还给触发按钮（键盘用户不丢位置）。
   *
   * 不能在这里直接 `focus()`：此刻 `adding` 还是 true，触发按钮还没渲染回来，
   * 拿到的 ref 是 null。标记一下，等 `adding` 变 false 的 effect 里再还。
   */
  const closeAdd = (): void => {
    returnFocusRef.current = true;
    setAdding(false);
  };

  useEffect(() => {
    if (adding || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    addTriggerRef.current?.focus();
  }, [adding]);

  return (
    <section style={ADMIN_BLOCK_STYLE} aria-labelledby={TITLE_ID}>
      <div style={SECTION_HEADING_STYLE}>
        <h3 id={TITLE_ID} style={TITLE_STYLE} aria-level={2}>
          {t(PASSKEY_KEYS.title)}
        </h3>
        <div style={SECTION_ACTIONS_STYLE}>
          {count === null ? null : (
            <span style={ADMIN_BADGE_STYLE}>{t(PASSKEY_KEYS.count, { count })}</span>
          )}
          {supported && canMutate && !adding ? (
            <ActionButton
              ref={addTriggerRef}
              variant="ghost"
              // 删除在飞时置灰：同一个状态机只允许一个写动作（C6）。
              disabled={actions.removing !== null}
              onClick={() => setAdding(true)}
            >
              {isEmpty ? t(PASSKEY_KEYS.emptyAction) : t(PASSKEY_KEYS.add)}
            </ActionButton>
          ) : null}
        </div>
      </div>
      <p style={HINT_STYLE}>{t(PASSKEY_KEYS.intro)}</p>
      <PasskeyBody
        t={t}
        state={state}
        actions={actions}
        totpEnabled={totpEnabled}
        onRetry={reload}
      />
      <PasskeyStatus failure={actions.failure} success={actions.success} />
      {adding ? (
        <PasskeyAddForm
          t={t}
          values={actions.values}
          invalid={actions.invalid}
          busy={actions.adding}
          totpEnabled={totpEnabled}
          onChange={actions.setValue}
          onSubmit={actions.add}
          onCancel={closeAdd}
        />
      ) : null}
      {supported ? null : <p style={HINT_STYLE}>{t(PASSKEY_KEYS.unsupported)}</p>}
    </section>
  );
}
