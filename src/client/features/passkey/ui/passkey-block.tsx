/**
 * 「通行密钥」区块（M6 PR3）：挂在「账号安全」设置页的已登录分支。
 *
 * 结构：标题 + 说明 + 列表（或空态）+ 添加表单 + 状态播报位。
 * 特性检测：`window.PublicKeyCredential` 不存在时**隐藏添加按钮**（列表照常显示，
 * 用户仍能看到/删除已有凭据）；无 JS 时整块不渲染（React 组件，本来就需要 JS）。
 */
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ADMIN_BLOCK_STYLE,
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  TITLE_STYLE,
} from "../../../shared/ui/index.ts";
import { isPasskeySupported } from "../api/passkey-codec.ts";
import { PasskeyAddForm } from "./passkey-add-form.tsx";
import { PasskeyStatus } from "./passkey-fields.tsx";
import { PasskeyTable } from "./passkey-table.tsx";
import { usePasskeyActions } from "../model/use-passkey-actions.ts";
import { usePasskeyList } from "../model/use-passkey-list.ts";

const TITLE_ID = "dsh-auth-gate-passkey-title";

export interface PasskeyBlockProps {
  /** 槽位注入的翻译 seat（含 `account.passkey.*` 键）。 */
  t: AccountTranslate;
}

/** 列表区：loading / 静默（受限会话）/ 错误 / 空态 / 表格。 */
function PasskeyListArea({
  t,
  state,
  removing,
  onRemove,
}: {
  t: AccountTranslate;
  state: ReturnType<typeof usePasskeyList>["state"];
  removing: string | null;
  onRemove: (idPrefix: string) => void;
}) {
  if (state.kind === "loading") return <p style={HINT_STYLE}>{t(PASSKEY_KEYS.loading)}</p>;
  // 受限会话（403）静默：这张 cookie 本来就不该看到管理面，与 admin 块同一策略。
  if (state.kind === "forbidden") return null;
  if (state.kind === "unauthorized") {
    return <p style={ERROR_TEXT_STYLE}>{t(PASSKEY_KEYS.unauthorized)}</p>;
  }
  if (state.kind === "failure") {
    return <p style={ERROR_TEXT_STYLE}>{t(PASSKEY_KEYS.unavailable)}</p>;
  }
  if (state.passkeys.length === 0) return <p style={HINT_STYLE}>{t(PASSKEY_KEYS.empty)}</p>;
  return <PasskeyTable t={t} passkeys={state.passkeys} removing={removing} onRemove={onRemove} />;
}

/**
 * 通行密钥区块：列表 + 添加/删除。`supported` 在渲染期算一次（特性检测是纯读操作），
 * 不支持时只隐藏添加表单，列表与删除仍可用。
 */
export function PasskeyBlock({ t }: PasskeyBlockProps) {
  const { state, reload } = usePasskeyList();
  const actions = usePasskeyActions(t, reload);
  const supported = isPasskeySupported();
  return (
    <section style={ADMIN_BLOCK_STYLE} aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} style={TITLE_STYLE}>
        {t(PASSKEY_KEYS.title)}
      </h3>
      <p style={HINT_STYLE}>{t(PASSKEY_KEYS.intro)}</p>
      <PasskeyListArea
        t={t}
        state={state}
        removing={actions.removing}
        onRemove={(idPrefix) => {
          void actions.remove(idPrefix);
        }}
      />
      <PasskeyStatus failure={actions.failure} success={actions.success} />
      {supported ? (
        <PasskeyAddForm
          t={t}
          values={actions.values}
          invalid={actions.invalid}
          busy={actions.adding}
          onChange={actions.setValue}
          onSubmit={actions.add}
        />
      ) : (
        <p style={HINT_STYLE}>{t(PASSKEY_KEYS.unsupported)}</p>
      )}
    </section>
  );
}
