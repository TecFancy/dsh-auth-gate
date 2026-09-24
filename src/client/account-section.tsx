import { useEffect, useState } from "react";
import {
  ACCOUNT_DICT_EN,
  ACCOUNT_KEYS,
  translateFrom,
  type AccountTranslate,
} from "./account-copy.ts";
import { AccountPasswordForm } from "./account-form.tsx";
import { HINT_STYLE, PANEL_STYLE } from "./account-styles.ts";

/** 会话探针（只认 cookie，语义同 `/auth/status`）。 */
const STATUS_TARGET = "/auth/status";

/** 提示态 id：loading / 未登录共用一个 aria-live 播报位。 */
const NOTICE_ID = "dsh-auth-gate-account-notice";

/**
 * 会话状态：null = 第一次请求返回前（组件自己处理 loading），true/false = 已确认。
 * 卸载即 abort，回调里再看一眼 signal，避免卸载后 setState。
 */
function useSessionStatus(): boolean | null {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(STATUS_TARGET, { signal: controller.signal, credentials: "same-origin" })
      .then((res) => res.json())
      .then((body: { authenticated?: unknown }) => {
        if (!controller.signal.aborted) setAuthenticated(body.authenticated === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuthenticated(false);
      });
    return () => {
      controller.abort();
    };
  }, []);
  return authenticated;
}

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
 * 槽位注入的 props：`t` 来自注册时的 `locale: "auth"` seat。
 * 宿主 owner props 还有 `close`；P1.1 起不再往下传（成功后去登录页，而不是关弹窗）。
 */
export interface SettingsAccountSectionProps {
  t?: AccountTranslate | undefined;
}

/**
 * 「账户」设置页（`settings.section`）：未登录不给表单；已登录渲染自助改密表单。
 * `t` 缺失时降级到英文词典（不显示键名），由 account-form 承担全部提交逻辑。
 */
export function SettingsAccountSection({ t }: SettingsAccountSectionProps) {
  const authenticated = useSessionStatus();
  const translate = typeof t === "function" ? t : translateFrom(ACCOUNT_DICT_EN);
  if (authenticated === null) return <Notice text={translate(ACCOUNT_KEYS.loading)} />;
  if (!authenticated) return <Notice text={translate(ACCOUNT_KEYS.loginRequired)} />;
  return <AccountPasswordForm t={translate} />;
}
