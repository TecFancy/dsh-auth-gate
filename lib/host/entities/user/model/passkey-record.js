import { z } from "zod";
/** 每用户 passkey 上限（`users.yaml` 契约）。 */
export const MAX_PASSKEYS_PER_USER = 10;
/** `passkeyUserHandle` 解码后的合法字节区间（随机 32 字节，留余量给其他实现）。 */
const USER_HANDLE_MIN_BYTES = 16;
const USER_HANDLE_MAX_BYTES = 64;
/** `credentialId` 解码后的合法字节区间（WebAuthn 上限 1023）。 */
const CREDENTIAL_ID_MIN_BYTES = 1;
const CREDENTIAL_ID_MAX_BYTES = 1023;
/** `publicKeyCose` 解码后的合法字节区间（原始 COSE，不转 JWK）。 */
const COSE_MIN_BYTES = 1;
const COSE_MAX_BYTES = 1024;
/** `label` 的字符数上限。 */
const LABEL_MAX_LENGTH = 64;
/** WebAuthn transport 标识：只接受这些值，读盘时去重且保留顺序。 */
export const PASSKEY_TRANSPORTS = [
    "usb",
    "nfc",
    "ble",
    "internal",
    "hybrid",
    "smart-card",
];
/** COSE 算法（`supportedAlgorithmIDs`）：ES256 / RS256 / EdDSA。 */
export const PASSKEY_ALGORITHMS = [-7, -257, -8];
/** base64url 字符集（无填充）；再解码回编码逐字一致，才拒绝非法长度。 */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
/** AAGUID 的 uuid 形式。 */
const AAGUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * 是否含控制符（C0、DEL、C1）。按码点逐字符判定而不是正则：eslint 的 `no-control-regex`
 * 拒绝 `[\u0000-\u001f]`（与 `shared/http`、`admin/audit.ts` 的判定口径一致）。
 */
function hasControlChars(value) {
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f))
            return true;
    }
    return false;
}
/** base64url 且解码后落在 [min, max] 字节（空串不合法）。 */
function base64UrlBytes(minBytes, maxBytes, description) {
    return z.string().refine((value) => {
        if (!BASE64URL_RE.test(value))
            return false;
        if (Buffer.from(value, "base64url").toString("base64url") !== value)
            return false;
        const length = Buffer.from(value, "base64url").length;
        return length >= minBytes && length <= maxBytes;
    }, { message: description });
}
/** 单把凭据：12 个键全必填（`.strict()`，未知键即失败；`false`/`0` 是显式值）。 */
export const passkeyRecordSchema = z
    .object({
    credentialId: base64UrlBytes(CREDENTIAL_ID_MIN_BYTES, CREDENTIAL_ID_MAX_BYTES, "credentialId must be base64url of 1-1023 bytes"),
    publicKeyCose: base64UrlBytes(COSE_MIN_BYTES, COSE_MAX_BYTES, "publicKeyCose must be base64url of 1-1024 bytes"),
    alg: z.literal(PASSKEY_ALGORITHMS),
    signCount: z.number().int().min(0).max(4294967295),
    aaguid: z.string().refine((value) => value === "" || AAGUID_RE.test(value), {
        message: "aaguid must be a uuid or an empty string",
    }),
    be: z.boolean(),
    bs: z.boolean(),
    uvInitialized: z.boolean(),
    transports: z.array(z.enum(PASSKEY_TRANSPORTS)).transform((values) => [...new Set(values)]),
    label: z
        .string()
        .refine((value) => value.length >= 1 && value.length <= LABEL_MAX_LENGTH && !hasControlChars(value), { message: "label must be 1-64 characters without control characters" }),
    createdAt: z.number().int().min(0),
    lastUsedAt: z.number().int().min(0),
})
    .strict();
/**
 * `users.yaml` 用户记录里的 passkey 两个键（`.strict()` 下新键必须显式声明）。
 * 单条记录的字节长度/枚举/控制字符校验在 schema 层完成；跨记录规则见 `validatePasskeyStore`。
 */
export const passkeyFieldsSchema = {
    passkeyUserHandle: base64UrlBytes(USER_HANDLE_MIN_BYTES, USER_HANDLE_MAX_BYTES, "passkeyUserHandle must be base64url of 16-64 bytes").optional(),
    passkeys: z
        .array(passkeyRecordSchema)
        .max(MAX_PASSKEYS_PER_USER, { message: `at most ${MAX_PASSKEYS_PER_USER} passkeys per user` })
        .optional(),
};
/** 单把凭据归一化：字段顺序固定，布尔与 0 保留，`transports` 去重后保留顺序。 */
function normalizePasskey(record) {
    return {
        credentialId: record.credentialId,
        publicKeyCose: record.publicKeyCose,
        alg: record.alg,
        signCount: record.signCount,
        aaguid: record.aaguid,
        be: record.be,
        bs: record.bs,
        uvInitialized: record.uvInitialized,
        transports: [...new Set(record.transports)],
        label: record.label,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
    };
}
/**
 * 读盘：schema 校验后的两个字段 → 存储形状。
 *
 * `passkeys` 恒在（缺省 `[]`，与 `role`/`mustChangePassword` 的读时补默认一致）；
 * `passkeyUserHandle` 缺失时保持 `undefined`，loader 不伪造。
 */
export function readPasskeyFields(record) {
    return {
        ...(record.passkeyUserHandle === undefined
            ? {}
            : { passkeyUserHandle: record.passkeyUserHandle }),
        passkeys: (record.passkeys ?? []).map(normalizePasskey),
    };
}
/**
 * 落盘：`undefined` 与空 `passkeys` 不写键，未注册 passkey 的旧文件输出逐字不变。
 * 记录内容不在这里校验：写盘前提是内存快照已由 loader/schema 校验过。
 */
export function writePasskeyFields(record) {
    const fields = {};
    if (record.passkeyUserHandle !== undefined) {
        fields.passkeyUserHandle = record.passkeyUserHandle;
    }
    if (record.passkeys !== undefined && record.passkeys.length > 0) {
        fields.passkeys = record.passkeys.map(normalizePasskey);
    }
    return fields;
}
/**
 * 跨记录规则（loader 读盘后、mutator 写盘前都调用，后者是 plan 要求的 TOCTOU 复核）：
 * 有凭据必须有 handle、每用户不超过上限、全局 `credentialId` 唯一。
 * 返回首个问题（operator 文案，调用方加 `invalid users file: ` 前缀），全通过返回 `undefined`。
 */
export function validatePasskeyStore(users) {
    const seen = new Set();
    for (const [name, user] of users) {
        const passkeys = user.passkeys ?? [];
        if (passkeys.length > MAX_PASSKEYS_PER_USER) {
            return `too many passkeys: ${name} (max ${MAX_PASSKEYS_PER_USER})`;
        }
        if (passkeys.length > 0 && user.passkeyUserHandle === undefined) {
            return `passkeys without passkeyUserHandle: ${name}`;
        }
        for (const passkey of passkeys) {
            if (seen.has(passkey.credentialId)) {
                return `duplicate credentialId: ${passkey.credentialId}`;
            }
            seen.add(passkey.credentialId);
        }
    }
    return undefined;
}
//# sourceMappingURL=passkey-record.js.map