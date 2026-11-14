/**
 * 条件 UI 开关（admin，M6 PR3）：登录页是否把 passkey 放进浏览器自动填充。
 *
 * 非 admin 的 403 静默不渲染（与 admin 块同一策略）；读写都走
 * `GET/POST /auth/passkey/settings`，写回成功后以服务端返回值为准（不乐观更新）。
 */
import { useEffect, useRef, useState } from "react";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ADMIN_BLOCK_STYLE,
  ERROR_TEXT_STYLE,
  HINT_STYLE,
  SUCCESS_TEXT_STYLE,
  TITLE_STYLE,
} from "../../../shared/ui/index.ts";
import { fetchPasskeySettings, updatePasskeySettings } from "../api/passkey-settings.ts";

const TITLE_ID = "dsh-auth-gate-passkey-settings-title";
const TOGGLE_ID = "dsh-auth-gate-passkey-settings-toggle";

/** 开关状态：loading / 静默（非 admin）/ 错误 / 就绪（含当前值）。 */
type ToggleState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "failure" }
  | { kind: "ok"; enabled: boolean };

export interface PasskeySettingsToggleProps {
  t: AccountTranslate;
}

/** 条件 UI 开关：读一次当前值，勾选即写回；失败保留原值并提示。 */
export function PasskeySettingsToggle({ t }: PasskeySettingsToggleProps) {
  const [state, setState] = useState<ToggleState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    abort.current = controller;
    void fetchPasskeySettings(controller.signal).then((result) => {
      if (!mounted.current || result.kind === "aborted") return;
      if (result.kind === "ok") setState({ kind: "ok", enabled: result.conditionalUiEnabled });
      else if (result.kind === "forbidden") setState({ kind: "forbidden" });
      else setState({ kind: "failure" });
    });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  const toggle = async (next: boolean): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await updatePasskeySettings(next, controller.signal);
      if (!mounted.current || result.kind === "aborted") return;
      if (result.kind === "ok") {
        setState({ kind: "ok", enabled: result.conditionalUiEnabled });
        setMessage(t(PASSKEY_KEYS.settingsSaved));
        return;
      }
      setError(t(PASSKEY_KEYS.settingsError));
    } catch {
      if (mounted.current) setError(t(PASSKEY_KEYS.settingsError));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  if (state.kind === "loading") return <p style={HINT_STYLE}>{t(PASSKEY_KEYS.loading)}</p>;
  if (state.kind === "forbidden") return null;
  if (state.kind === "failure") {
    return <p style={ERROR_TEXT_STYLE}>{t(PASSKEY_KEYS.unavailable)}</p>;
  }
  return (
    <section style={ADMIN_BLOCK_STYLE} aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} style={TITLE_STYLE}>
        {t(PASSKEY_KEYS.settingsTitle)}
      </h3>
      <p style={HINT_STYLE}>{t(PASSKEY_KEYS.settingsIntro)}</p>
      <label htmlFor={TOGGLE_ID} style={HINT_STYLE}>
        <input
          id={TOGGLE_ID}
          type="checkbox"
          checked={state.enabled}
          disabled={saving}
          onChange={(event) => void toggle(event.target.checked)}
        />{" "}
        {t(PASSKEY_KEYS.settingsLabel)}
      </label>
      {message === null ? null : <p style={SUCCESS_TEXT_STYLE}>{message}</p>}
      {error === null ? null : <p style={ERROR_TEXT_STYLE}>{error}</p>}
    </section>
  );
}
