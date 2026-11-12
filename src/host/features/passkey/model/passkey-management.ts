/**
 * passkey 注册/管理端点的纯策略（无 IO、无 HTTP）：label 校验、transports 归一化、
 * 列表投影、credentialId 前缀匹配、注册记录组装。
 *
 * 允许的 transport 与 COSE 算法在这里各留一份字面量：`entities/user` 的 schema 是落盘契约的
 * 权威，但它的常量没有经 barrel 导出，features 不能深引（FSD 公共 API）。
 */
import {
  MAX_PASSKEYS_PER_USER,
  PASSKEY_ALGORITHMS,
  PASSKEY_TRANSPORTS,
  type PasskeyRecord,
} from "../../../entities/user/index.js";
import type { PasskeySummary } from "../../../shared/protocol/index.js";

/** label 的字符上限（与 `users.yaml` 的 schema 一致）。 */
export const PASSKEY_LABEL_MAX_LENGTH = 64;

/** 删除时 credentialId 前缀的最短长度（与 CLI 同口径）。 */
export const PASSKEY_ID_PREFIX_MIN_LENGTH = 8;

/** 列表里 credentialId 的展示前缀长度。 */
export const PASSKEY_SUMMARY_PREFIX_LENGTH = 12;

/** 注册允许的 COSE 算法（ES256 / RS256 / EdDSA）；权威定义在 `entities/user` 的 schema。 */
export const PASSKEY_SUPPORTED_ALGORITHMS = PASSKEY_ALGORITHMS;

/** 注册允许的 COSE 算法取值。 */
export type PasskeyAlgorithm = (typeof PASSKEY_SUPPORTED_ALGORITHMS)[number];

/** 认证器 transport 白名单；权威定义在 `entities/user` 的 schema。 */
const ALLOWED_TRANSPORTS: ReadonlySet<string> = new Set(PASSKEY_TRANSPORTS);

/** 是否含控制符（C0、DEL、C1）；按码点判定，避免 `no-control-regex`。 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * 归一化用户填的 label：trim 后 1–64 字符且不含控制字符；不合法返回 undefined
 * （端点回 400，不落盘）。
 */
export function normalizePasskeyLabel(raw: string): string | undefined {
  const label = raw.trim();
  if (label.length === 0 || label.length > PASSKEY_LABEL_MAX_LENGTH) return undefined;
  if (hasControlChars(label)) return undefined;
  return label;
}

/**
 * 解析表单里的 `transports`（逗号分隔）：只保留白名单值、去重、保持顺序。
 * 未知值静默丢弃（认证器上报的 transport 只是提示，不是安全边界）。
 */
export function parseTransports(raw: string): string[] {
  const transports: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === "" || !ALLOWED_TRANSPORTS.has(value) || transports.includes(value)) continue;
    transports.push(value);
  }
  return transports;
}

/** 记录 → 列表行：只出 id 前缀与展示字段，绝不带 `publicKeyCose`/`passkeyUserHandle`。 */
export function toPasskeySummary(record: PasskeyRecord): PasskeySummary {
  return {
    idPrefix: record.credentialId.slice(0, PASSKEY_SUMMARY_PREFIX_LENGTH),
    label: record.label,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    backupEligible: record.be,
    backupState: record.bs,
    transports: [...record.transports],
  };
}

/** 列表顺序：`createdAt` 升序（同刻按 credentialId 稳定排序，client 不重排）。 */
export function sortPasskeysByCreatedAt(records: readonly PasskeyRecord[]): PasskeyRecord[] {
  return [...records].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.credentialId.localeCompare(right.credentialId),
  );
}

/** 前缀匹配结论：未命中 / 歧义 / 唯一命中。 */
export type CredentialPrefixMatch =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "match"; readonly record: PasskeyRecord };

/**
 * 按 credentialId 前缀找唯一凭据：前缀短于 8 字符、无命中 → `none`；多命中 → `ambiguous`
 * （端点分别回 404 / 400，绝不猜）。
 */
export function matchCredentialPrefix(
  records: readonly PasskeyRecord[],
  prefix: string,
): CredentialPrefixMatch {
  if (prefix.length < PASSKEY_ID_PREFIX_MIN_LENGTH) return { kind: "none" };
  const matches = records.filter((record) => record.credentialId.startsWith(prefix));
  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous" };
  const record = matches[0];
  return record === undefined ? { kind: "none" } : { kind: "match", record };
}

/** 是否还能再加一把（每用户上限）。 */
export function canAddPasskey(records: readonly PasskeyRecord[]): boolean {
  return records.length < MAX_PASSKEYS_PER_USER;
}

/** 组装一条待落盘的凭据记录（字段全部来自库的校验结果与 ceremony）。 */
export interface NewPasskeyInput {
  readonly credentialId: string;
  readonly publicKeyCose: string;
  readonly alg: PasskeyAlgorithm;
  readonly signCount: number;
  readonly aaguid: string;
  readonly be: boolean;
  readonly bs: boolean;
  readonly uvInitialized: boolean;
  readonly transports: string[];
  readonly label: string;
  readonly createdAt: number;
}

/** 组装 `users.yaml` 的 `passkeys[]` 元素；`lastUsedAt` 恒 0（从未使用）。 */
export function buildPasskeyRecord(input: NewPasskeyInput): PasskeyRecord {
  return {
    credentialId: input.credentialId,
    publicKeyCose: input.publicKeyCose,
    alg: input.alg,
    signCount: input.signCount,
    aaguid: input.aaguid,
    be: input.be,
    bs: input.bs,
    uvInitialized: input.uvInitialized,
    transports: [...input.transports],
    label: input.label,
    createdAt: input.createdAt,
    lastUsedAt: 0,
  };
}
