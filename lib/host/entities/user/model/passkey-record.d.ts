import { z } from "zod";
/** 每用户 passkey 上限（`users.yaml` 契约）。 */
export declare const MAX_PASSKEYS_PER_USER = 10;
/** WebAuthn transport 标识：只接受这些值，读盘时去重且保留顺序。 */
export declare const PASSKEY_TRANSPORTS: readonly ["usb", "nfc", "ble", "internal", "hybrid", "smart-card"];
/** COSE 算法（`supportedAlgorithmIDs`）：ES256 / RS256 / EdDSA。 */
export declare const PASSKEY_ALGORITHMS: readonly [-7, -257, -8];
/**
 * `users.yaml` 里的一把通行密钥（owner 用户 `passkeys[]` 的元素）。
 *
 * 二进制一律存 base64url（无填充）。`signCount`/`lastUsedAt` 落盘值只用于展示与尽力检测，
 * 不代表可靠的克隆防护：登录路径按进程内节流写回。
 */
export interface PasskeyRecord {
    /** base64url，解码 1–1023 字节。 */
    credentialId: string;
    /** base64url 原始 COSE 公钥，解码 1–1024 字节。 */
    publicKeyCose: string;
    /** COSE 算法：-7 ES256 / -257 RS256 / -8 EdDSA。 */
    alg: -7 | -257 | -8;
    /** 认证器签名计数器，0..4294967295 的整数。 */
    signCount: number;
    /** 认证器 AAGUID（uuid 形式）；未知时为空串。 */
    aaguid: string;
    /** BE（backup eligible）标志；安全语义，`false` 也必须显式落盘。 */
    be: boolean;
    /** BS（backup state）标志；安全语义，`false` 也必须显式落盘。 */
    bs: boolean;
    /** 注册时是否要求了用户验证（UV）。 */
    uvInitialized: boolean;
    /** 认证器报告的 transport 子集（只含 `PASSKEY_TRANSPORTS`，去重）。 */
    transports: string[];
    /** 展示名，1–64 字符，不含控制字符。 */
    label: string;
    /** 创建时间（epoch ms），非负整数。 */
    createdAt: number;
    /** 最近使用时间（epoch ms），非负整数；0 表示从未使用。 */
    lastUsedAt: number;
}
/** 用户记录里参与存储的两个字段；`undefined` 表示 YAML 里没有该键。 */
export interface PasskeyFields {
    passkeyUserHandle?: string;
    passkeys?: PasskeyRecord[];
}
/** 单把凭据：12 个键全必填（`.strict()`，未知键即失败；`false`/`0` 是显式值）。 */
export declare const passkeyRecordSchema: z.ZodObject<{
    credentialId: z.ZodString;
    publicKeyCose: z.ZodString;
    alg: z.ZodLiteral<-7 | -257 | -8>;
    signCount: z.ZodNumber;
    aaguid: z.ZodString;
    be: z.ZodBoolean;
    bs: z.ZodBoolean;
    uvInitialized: z.ZodBoolean;
    transports: z.ZodPipe<z.ZodArray<z.ZodEnum<{
        usb: "usb";
        nfc: "nfc";
        ble: "ble";
        internal: "internal";
        hybrid: "hybrid";
        "smart-card": "smart-card";
    }>>, z.ZodTransform<("usb" | "nfc" | "ble" | "internal" | "hybrid" | "smart-card")[], ("usb" | "nfc" | "ble" | "internal" | "hybrid" | "smart-card")[]>>;
    label: z.ZodString;
    createdAt: z.ZodNumber;
    lastUsedAt: z.ZodNumber;
}, z.core.$strict>;
/**
 * `users.yaml` 用户记录里的 passkey 两个键（`.strict()` 下新键必须显式声明）。
 * 单条记录的字节长度/枚举/控制字符校验在 schema 层完成；跨记录规则见 `validatePasskeyStore`。
 */
export declare const passkeyFieldsSchema: {
    passkeyUserHandle: z.ZodOptional<z.ZodString>;
    passkeys: z.ZodOptional<z.ZodArray<z.ZodObject<{
        credentialId: z.ZodString;
        publicKeyCose: z.ZodString;
        alg: z.ZodLiteral<-7 | -257 | -8>;
        signCount: z.ZodNumber;
        aaguid: z.ZodString;
        be: z.ZodBoolean;
        bs: z.ZodBoolean;
        uvInitialized: z.ZodBoolean;
        transports: z.ZodPipe<z.ZodArray<z.ZodEnum<{
            usb: "usb";
            nfc: "nfc";
            ble: "ble";
            internal: "internal";
            hybrid: "hybrid";
            "smart-card": "smart-card";
        }>>, z.ZodTransform<("usb" | "nfc" | "ble" | "internal" | "hybrid" | "smart-card")[], ("usb" | "nfc" | "ble" | "internal" | "hybrid" | "smart-card")[]>>;
        label: z.ZodString;
        createdAt: z.ZodNumber;
        lastUsedAt: z.ZodNumber;
    }, z.core.$strict>>>;
};
/**
 * 读盘：schema 校验后的两个字段 → 存储形状。
 *
 * `passkeys` 恒在（缺省 `[]`，与 `role`/`mustChangePassword` 的读时补默认一致）；
 * `passkeyUserHandle` 缺失时保持 `undefined`，loader 不伪造。
 */
export declare function readPasskeyFields(record: {
    passkeyUserHandle?: string | undefined;
    passkeys?: PasskeyRecord[] | undefined;
}): {
    passkeyUserHandle?: string;
    passkeys: PasskeyRecord[];
};
/**
 * 落盘：`undefined` 与空 `passkeys` 不写键，未注册 passkey 的旧文件输出逐字不变。
 * 记录内容不在这里校验：写盘前提是内存快照已由 loader/schema 校验过。
 */
export declare function writePasskeyFields(record: PasskeyFields): PasskeyFields;
/**
 * 跨记录规则（loader 读盘后、mutator 写盘前都调用，后者是 plan 要求的 TOCTOU 复核）：
 * 有凭据必须有 handle、每用户不超过上限、全局 `credentialId` 唯一。
 * 返回首个问题（operator 文案，调用方加 `invalid users file: ` 前缀），全通过返回 `undefined`。
 */
export declare function validatePasskeyStore(users: Iterable<readonly [string, PasskeyFields]>): string | undefined;
//# sourceMappingURL=passkey-record.d.ts.map