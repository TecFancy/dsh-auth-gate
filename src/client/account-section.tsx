import {
  ACCOUNT_DICT_EN,
  ACCOUNT_KEYS,
  translateFrom,
  type AccountTranslate,
} from "./account-copy.ts";
import { AccountPasswordForm } from "./account-form.tsx";
import { HINT_STYLE, PANEL_STYLE } from "./account-styles.ts";
import { AdminUsersBlock } from "./admin-block.tsx";
import { ADMIN_DICT_EN } from "./admin-copy.ts";
import type { AccountStatusView } from "./admin-types.ts";
import { useAccountStatus } from "./account-status.ts";

/** 提示态 id：loading / 未登录共用一个 aria-live 播报位。 */
const NOTICE_ID = "dsh-auth-gate-account-notice";

/** 无表单的提示态（loading / 请先登录），保留 aria-live 播报。 */
function Notice({ text }: { text: string }) {
  return (
    <section style={PANEL_STYLE}>
      <p id={NOTICE_ID} role="status" aria-live="polite" style={HINT_STYLE}>
        {text}
      </p>
    </section>
  );
}

/**
 * 管理块渲染门（契约 §9-A1，四条**同时**成立才渲染）：`role === "admin"`、
 * `disabled === false`、`sessionKind === "full"`、`name` 是字符串。
 * **不做 `?? "full"` 兜底**：任一字段缺失或非该值 = 不渲染且零管理请求
 * （旧服务端/部分字段与「非 admin 不试拉」加法兼容；禁用 admin 不挂块）。
 */
function showsAdminBlock(
  status: AccountStatusView,
): status is AccountStatusView & { name: string } {
  return (
    status.role === "admin" &&
    status.disabled === false &&
    status.sessionKind === "full" &&
    typeof status.name === "string"
  );
}

/**
 * 槽位注入的 props：`t` 来自注册时的 `locale: "auth"` seat。
 * 宿主 owner props 还有 `close`；P1.1 起不再往下传（成功后去登录页，而不是关弹窗）。
 */
export interface SettingsAccountSectionProps {
  t?: AccountTranslate | undefined;
}

/**
 * 「账户」设置页（`settings.section`）：未登录不给表单；已登录渲染自助改密表单，
 * 并在身份满足渲染门时（admin + 正式会话）追加管理块。`t` 缺失时降级到英文词典
 * （不显示键名），由 account-form / admin-block 承担各自的提交逻辑。
 */
export function SettingsAccountSection({ t }: SettingsAccountSectionProps) {
  const status = useAccountStatus();
  // `t` 缺失的降级词典必须同时含 account 与 admin 两片（否则管理块会显示键名，grok 回顾 #1）。
  const translate =
    typeof t === "function" ? t : translateFrom({ ...ACCOUNT_DICT_EN, ...ADMIN_DICT_EN });
  if (status === null) return <Notice text={translate(ACCOUNT_KEYS.loading)} />;
  if (status.authenticated !== true) return <Notice text={translate(ACCOUNT_KEYS.loginRequired)} />;
  return (
    <>
      <AccountPasswordForm t={translate} />
      {showsAdminBlock(status) ? (
        <AdminUsersBlock
          t={translate}
          actorName={status.name}
          // 未知（旧服务端缺字段）时**渲染**动态码框：宁可多发一个被忽略的 code，
          // 也不能在服务端已开 TOTP 时因缺码被 401 invalid_totp（grok 回顾 #2）。
          actorTotpEnabled={status.totpEnabled !== false}
        />
      ) : null}
    </>
  );
}
