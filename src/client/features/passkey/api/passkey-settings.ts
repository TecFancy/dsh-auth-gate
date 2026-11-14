/**
 * 条件 UI 设置（admin）：`GET/POST /auth/passkey/settings`。
 *
 * 非 admin 的 403 映射成 `forbidden`：调用方据此**静默不渲染**开关（与 admin 块同一策略）。
 * 404 同样静默：`passkey: "off"` 时端点根本不注册，此时不该在面板上留一条「暂时不可用」。
 */
import {
  encodeForm,
  PASSKEY_SETTINGS_PATH,
  type PasskeySettingsRequest,
} from "../../../shared/api/index.ts";
import type { PasskeySettingsResult } from "../model/passkey-form.ts";
import { isRecord, readJsonSafe } from "./passkey-http.ts";

const SETTINGS_TARGET = PASSKEY_SETTINGS_PATH;

/** 设置响应解析：只认 `{conditionalUiEnabled: boolean}`。 */
function parseSettings(body: unknown): PasskeySettingsResult {
  if (!isRecord(body)) return { kind: "failure" };
  const enabled = body["conditionalUiEnabled"];
  return typeof enabled === "boolean"
    ? { kind: "ok", conditionalUiEnabled: enabled }
    : { kind: "failure" };
}

/** `GET /auth/passkey/settings`（admin）：403 → `forbidden`（非 admin 静默不渲染）。 */
export async function fetchPasskeySettings(signal: AbortSignal): Promise<PasskeySettingsResult> {
  try {
    const res = await fetch(SETTINGS_TARGET, { method: "GET", signal, credentials: "same-origin" });
    if (signal.aborted) return { kind: "aborted" };
    if (res.status === 403 || res.status === 404) return { kind: "forbidden" };
    if (!res.ok) return { kind: "failure" };
    const body = await readJsonSafe(res);
    if (signal.aborted) return { kind: "aborted" };
    return parseSettings(body);
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
  }
}

/** `POST /auth/passkey/settings`（admin）：写回条件 UI 开关（`"1"` / `"0"`）。 */
export async function updatePasskeySettings(
  enabled: boolean,
  signal: AbortSignal,
): Promise<PasskeySettingsResult> {
  const request: PasskeySettingsRequest = { conditionalUi: enabled ? "1" : "0" };
  try {
    const res = await fetch(SETTINGS_TARGET, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: encodeForm(request),
      signal,
      credentials: "same-origin",
    });
    if (signal.aborted) return { kind: "aborted" };
    if (res.status === 403 || res.status === 404) return { kind: "forbidden" };
    if (!res.ok) return { kind: "failure" };
    const body = await readJsonSafe(res);
    if (signal.aborted) return { kind: "aborted" };
    return parseSettings(body);
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
  }
}
