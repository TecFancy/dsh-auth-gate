import { Component, type ReactNode } from "react";
import {
  ACCOUNT_DICT_EN,
  ACCOUNT_KEYS,
  translateFrom,
  type AccountTranslate,
} from "../../../shared/i18n/index.ts";
import { AccountContext, AccountPasswordForm } from "../../../features/change-password/index.ts";
import { PasskeyBlock, PasskeySettingsToggle } from "../../../features/passkey/index.ts";
import { ActionButton, HINT_STYLE, PANEL_STYLE, TITLE_STYLE } from "../../../shared/ui/index.ts";
import { AdminUsersBlock } from "./admin-block.tsx";
import { AccountSectionFooter } from "./section-footer.tsx";
import { ADMIN_DICT_EN } from "../../../features/admin-users/index.ts";
import type { AccountStatusView } from "../../../entities/account/index.ts";
import { useAccountStatus } from "../../../entities/account/index.ts";

/** 提示态 id：loading / 未登录 / 探针失败共用一个 aria-live 播报位。 */
const NOTICE_ID = "dsh-auth-gate-account-notice";

/** 实例管理区的标题 id。 */
const ADMIN_AREA_TITLE_ID = "dsh-auth-gate-admin-area-title";

/** 无表单的提示态（loading / 未登录 / 探针失败 / 渲染兜底），保留 aria-live 播报。 */
function Notice({
  text,
  retryLabel,
  onRetry,
}: {
  text: string;
  retryLabel?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <section style={PANEL_STYLE}>
      <p id={NOTICE_ID} role="status" aria-live="polite" style={HINT_STYLE}>
        {text}
      </p>
      {onRetry === undefined ? null : (
        <ActionButton variant="ghost" onClick={onRetry}>
          {retryLabel ?? text}
        </ActionButton>
      )}
    </section>
  );
}

/** 错误边界的兜底状态（整块渲染崩溃时收敛爆炸半径，不让宿主设置页一起白屏）。 */
interface BoundaryState {
  failed: boolean;
}

/**
 * 账户区错误边界（C7）：`formatPasskeyDate` 这类渲染期异常只炸这一块，不留白整个设置面板。
 *
 * 边界只接渲染期异常；请求失败仍由各自的 hook 落成可重试的状态。
 */
class SectionErrorBoundary extends Component<
  { fallback: string; children: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) return <Notice text={this.props.fallback} />;
    return this.props.children;
  }
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
 * passkey 区块渲染门：只有服务端明确报告 `passkeyEnabled === true` 才挂块。
 *
 * 三条理由：默认配置是 `passkey: "off"`（端点根本不存在，挂了只会拿到 404 并显示
 * 「暂时不可用」）；旧服务端没有该字段（`undefined` = 不知道，不推断为开启）；
 * 关闭时零请求，与「非 admin 不试拉管理面」同一纪律。
 */
function showsPasskeyBlock(status: AccountStatusView): boolean {
  return status.passkeyEnabled === true;
}

/** 内容区：依赖已解析的 status 与 translate（错误边界只包这一层）。 */
function AccountSectionContent({ t }: { t: AccountTranslate }) {
  const { state, retry } = useAccountStatus();
  if (state.kind === "loading") return <Notice text={t(ACCOUNT_KEYS.loading)} />;
  // 探针失败（网络/5xx）不是「未登录」：给独立的不可用提示 + 重试，不误导用户去重新登录（C9）。
  if (state.kind === "failure") {
    return (
      <Notice
        text={t(ACCOUNT_KEYS.unavailable)}
        retryLabel={t(ACCOUNT_KEYS.retry)}
        onRetry={retry}
      />
    );
  }
  const status = state.status;
  if (status.authenticated !== true) return <Notice text={t(ACCOUNT_KEYS.loginRequired)} />;
  const admin = showsAdminBlock(status);
  return (
    <>
      <AccountContext
        t={t}
        name={status.name}
        role={status.role}
        totpEnabled={status.totpEnabled}
      />
      {status.passwordLoginDisabled === true ? (
        <p style={HINT_STYLE} role="status">
          {t(ACCOUNT_KEYS.passkeyOnlyNotice)}
        </p>
      ) : null}
      <AccountPasswordForm t={t} totpEnabled={status.totpEnabled} />
      {showsPasskeyBlock(status) ? <PasskeyBlock t={t} totpEnabled={status.totpEnabled} /> : null}
      {admin ? (
        <section
          style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}
          aria-labelledby={ADMIN_AREA_TITLE_ID}
        >
          <h2 id={ADMIN_AREA_TITLE_ID} style={TITLE_STYLE}>
            {t(ACCOUNT_KEYS.adminAreaTitle)}
          </h2>
          <p style={HINT_STYLE}>{t(ACCOUNT_KEYS.adminAreaIntro)}</p>
          <AdminUsersBlock
            t={t}
            actorName={status.name}
            // 未知（旧服务端缺字段）时**渲染**动态码框：宁可多发一个被忽略的 code，
            // 也不能在服务端已开 TOTP 时因缺码被 401 invalid_totp（grok 回顾 #2）。
            actorTotpEnabled={status.totpEnabled !== false}
          />
          {showsPasskeyBlock(status) ? <PasskeySettingsToggle t={t} /> : null}
        </section>
      ) : null}
      {/* 页脚恒在最后一块之后：版本对所有人（报障先问版本），星标只对运营者（见 section-footer.tsx）。 */}
      <AccountSectionFooter
        t={t}
        version={status.version}
        showStar={admin || status.mode === "token"}
      />
    </>
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
 *
 * 重设计（2026-11-16）的信息架构：**所有身份先看完全相同的「我的安全」自助区**
 * （账号上下文 + 改密 + 通行密钥），管理员只在后面追加一个「实例管理」区。
 * 不引入 tabs：管理员不是换一套页面，而是同一页面上多一段。
 */
export function SettingsAccountSection({ t }: SettingsAccountSectionProps) {
  // `t` 缺失的降级词典必须同时含 account 与 admin 两片（否则管理块会显示键名，grok 回顾 #1）。
  const translate =
    typeof t === "function" ? t : translateFrom({ ...ACCOUNT_DICT_EN, ...ADMIN_DICT_EN });
  return (
    <SectionErrorBoundary fallback={translate(ACCOUNT_KEYS.loadFailed)}>
      <AccountSectionContent t={translate} />
    </SectionErrorBoundary>
  );
}
