/**
 * passkey 注册/管理端点的纯策略（无 IO、无 HTTP）：label 校验、transports 归一化、
 * 列表投影、credentialId 前缀匹配、注册记录组装。
 *
 * 允许的 transport 与 COSE 算法在这里各留一份字面量：`entities/user` 的 schema 是落盘契约的
 * 权威，但它的常量没有经 barrel 导出，features 不能深引（FSD 公共 API）。
 */
import { type PasskeyRecord } from "../../../entities/user/index.js";
import type { PasskeySummary } from "../../../shared/protocol/index.js";
/** label 的字符上限（与 `users.yaml` 的 schema 一致）。 */
export declare const PASSKEY_LABEL_MAX_LENGTH = 64;
/** 删除时 credentialId 前缀的最短长度（与 CLI 同口径）。 */
export declare const PASSKEY_ID_PREFIX_MIN_LENGTH = 8;
/** 列表里 credentialId 的展示前缀长度。 */
export declare const PASSKEY_SUMMARY_PREFIX_LENGTH = 12;
/** 注册允许的 COSE 算法（ES256 / RS256 / EdDSA）；权威定义在 `entities/user` 的 schema。 */
export declare const PASSKEY_SUPPORTED_ALGORITHMS: readonly [-7, -257, -8];
/** 注册允许的 COSE 算法取值。 */
export type PasskeyAlgorithm = (typeof PASSKEY_SUPPORTED_ALGORITHMS)[number];
/**
 * 归一化用户填的 label：trim 后 1–64 字符且不含控制字符；不合法返回 undefined
 * （端点回 400，不落盘）。
 */
export declare function normalizePasskeyLabel(raw: string): string | undefined;
/**
 * 解析表单里的 `transports`（逗号分隔）：只保留白名单值、去重、保持顺序。
 * 未知值静默丢弃（认证器上报的 transport 只是提示，不是安全边界）。
 */
export declare function parseTransports(raw: string): string[];
/** 记录 → 列表行：只出 id 前缀与展示字段，绝不带 `publicKeyCose`/`passkeyUserHandle`。 */
export declare function toPasskeySummary(record: PasskeyRecord): PasskeySummary;
/** 列表顺序：`createdAt` 升序（同刻按 credentialId 稳定排序，client 不重排）。 */
export declare function sortPasskeysByCreatedAt(records: readonly PasskeyRecord[]): PasskeyRecord[];
/** 前缀匹配结论：未命中 / 歧义 / 唯一命中。 */
export type CredentialPrefixMatch = {
    readonly kind: "none";
} | {
    readonly kind: "ambiguous";
} | {
    readonly kind: "match";
    readonly record: PasskeyRecord;
};
/**
 * 按 credentialId 前缀找唯一凭据：前缀短于 8 字符、无命中 → `none`；多命中 → `ambiguous`
 * （端点分别回 404 / 400，绝不猜）。
 */
export declare function matchCredentialPrefix(records: readonly PasskeyRecord[], prefix: string): CredentialPrefixMatch;
/** 是否还能再加一把（每用户上限）。 */
export declare function canAddPasskey(records: readonly PasskeyRecord[]): boolean;
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
export declare function buildPasskeyRecord(input: NewPasskeyInput): PasskeyRecord;
//# sourceMappingURL=passkey-management.d.ts.map