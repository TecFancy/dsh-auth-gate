/**
 * WebAuthn 的浏览器侧编解码（M6 PR3）：base64url ↔ ArrayBuffer、库 options JSON →
 * `navigator.credentials.create` 的 `publicKey`、认证器 transports 提取、特性检测。
 *
 * 手写而不引 `@simplewebauthn/browser`：client bundle 保持零第三方依赖（与登录页同一约束）。
 * 这里不是安全边界（服务端用库校验），只是把 JSON 形状转成浏览器 API 要的二进制。
 */
/** 对象守卫：只用于读未校验的 JSON。 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** base64url → ArrayBuffer（补 padding；`atob` 只认标准 base64）。 */
export declare function decodeBase64Url(value: string): ArrayBuffer;
/** ArrayBuffer → base64url（无 padding）。 */
export declare function encodeBase64Url(value: ArrayBuffer): string;
/** 浏览器是否支持 WebAuthn（`PublicKeyCredential` 存在且 `credentials.create` 可用）。 */
export declare function isPasskeySupported(): boolean;
/** 把 options JSON 转成 `navigator.credentials.create` 的 `publicKey`；形状非法返回 undefined。 */
export declare function toCreationOptions(raw: unknown): PublicKeyCredentialCreationOptions | undefined;
/** 认证器上报的 transports（逗号分隔，与 host 的 `parseTransports` 同口径）。 */
export declare function transportsOf(credential: PublicKeyCredential): string;
/** 用户取消（`NotAllowedError`）与超时都按「中止」处理：不显示错误，恢复按钮即可。 */
export declare function isCancelled(error: unknown): boolean;
//# sourceMappingURL=passkey-codec.d.ts.map