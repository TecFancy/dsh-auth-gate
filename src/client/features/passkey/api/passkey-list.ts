/**
 * `GET /auth/passkey`：自己的凭据列表（M6 PR3）。
 *
 * 逐字段白名单解析：任一必需字段类型不符即丢弃该行，`passkeys` 不是数组则整表 failure。
 * 保持服务端顺序（createdAt 升序），client 不重排。
 */
import { PASSKEY_PATH } from "../../../shared/api/index.ts";
import type { PasskeyListResult, PasskeySummaryView } from "../model/passkey-form.ts";
import { isRecord, readJsonSafe } from "./passkey-http.ts";

const LIST_TARGET = PASSKEY_PATH;

/** 单行形状校验：任一必需字段类型不符即丢弃该行（不整表失败）。 */
function asSummary(value: unknown): PasskeySummaryView | undefined {
  if (!isRecord(value)) return undefined;
  const { idPrefix, label, createdAt, lastUsedAt, backupEligible, backupState, transports } = value;
  if (typeof idPrefix !== "string" || idPrefix === "") return undefined;
  if (typeof label !== "string") return undefined;
  if (typeof createdAt !== "number" || typeof lastUsedAt !== "number") return undefined;
  if (typeof backupEligible !== "boolean" || typeof backupState !== "boolean") return undefined;
  if (!Array.isArray(transports)) return undefined;
  const list = transports.filter((item): item is string => typeof item === "string");
  return { idPrefix, label, createdAt, lastUsedAt, backupEligible, backupState, transports: list };
}

/** 解析 200 body；`passkeys` 不是数组视为形状非法（整表 failure）。 */
export function parsePasskeyList(body: unknown): PasskeySummaryView[] | undefined {
  if (!isRecord(body)) return undefined;
  const raw = body["passkeys"];
  if (!Array.isArray(raw)) return undefined;
  return raw.map(asSummary).filter((row): row is PasskeySummaryView => row !== undefined);
}

/**
 * `GET /auth/passkey`：401 → `unauthorized`（登录态已死）；403 → `forbidden`（受限会话）；
 * 非 200 / 形状非法 / 网络抛错 → `failure`；中止 → `aborted`。
 */
export async function fetchPasskeys(signal: AbortSignal): Promise<PasskeyListResult> {
  try {
    const res = await fetch(LIST_TARGET, { method: "GET", signal, credentials: "same-origin" });
    if (signal.aborted) return { kind: "aborted" };
    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (!res.ok) return { kind: "failure" };
    const body = await readJsonSafe(res);
    if (signal.aborted) return { kind: "aborted" };
    const passkeys = parsePasskeyList(body);
    return passkeys === undefined ? { kind: "failure" } : { kind: "ok", passkeys };
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
  }
}
