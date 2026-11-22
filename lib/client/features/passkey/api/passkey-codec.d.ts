/** base64url → ArrayBuffer（补 padding；`atob` 只认标准 base64）。 */
export declare function decodeBase64Url(value: string): ArrayBuffer;
/** ArrayBuffer → base64url（无 padding）。 */
export declare function encodeBase64Url(value: ArrayBuffer): string;
/** 浏览器是否支持 WebAuthn（`PublicKeyCredential` 存在且 `credentials.create` 可用）。 */
export declare function isPasskeySupported(): boolean;
/**
 * 把服务端下发的 options JSON 转成 `navigator.credentials.create` 的 `publicKey`。
 *
 * 必需字段（`challenge`/`rp`/`user`/`pubKeyCredParams`）任一非法即返回 `undefined`
 * （调用方按 generic 失败处理）；可选字段逐项白名单校验，非法即不下发。
 */
export declare function toCreationOptions(raw: unknown): PublicKeyCredentialCreationOptions | undefined;
/** 认证器上报的 transports（逗号分隔，与 host 的 `parseTransports` 同口径）。 */
export declare function transportsOf(credential: PublicKeyCredential): string;
/** 用户取消（`NotAllowedError`）与超时都按「中止」处理：不显示错误，恢复按钮即可。 */
export declare function isCancelled(error: unknown): boolean;
