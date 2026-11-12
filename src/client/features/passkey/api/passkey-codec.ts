/**
 * WebAuthn 的浏览器侧编解码（M6 PR3）：base64url ↔ ArrayBuffer、库 options JSON →
 * `navigator.credentials.create` 的 `publicKey`、认证器 transports 提取、特性检测。
 *
 * 手写而不引 `@simplewebauthn/browser`：client bundle 保持零第三方依赖（与登录页同一约束）。
 * 这里不是安全边界（服务端用库校验），只是把 JSON 形状转成浏览器 API 要的二进制。
 */

/** 对象守卫：只用于读未校验的 JSON。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** base64url → ArrayBuffer（补 padding；`atob` 只认标准 base64）。 */
export function decodeBase64Url(value: string): ArrayBuffer {
  const text = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** ArrayBuffer → base64url（无 padding）。 */
export function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 浏览器是否支持 WebAuthn（`PublicKeyCredential` 存在且 `credentials.create` 可用）。 */
export function isPasskeySupported(): boolean {
  const scope = globalThis as unknown as {
    PublicKeyCredential?: unknown;
    navigator?: { credentials?: { create?: unknown } };
  };
  return (
    typeof scope.PublicKeyCredential === "function" &&
    typeof scope.navigator?.credentials?.create === "function"
  );
}

/** 库的 options JSON 里我们真正要转成二进制的字段（其余原样透传）。 */
interface CreationOptionsJson {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
  authenticatorSelection?: Record<string, unknown>;
  attestation?: string;
  extensions?: Record<string, unknown>;
}

/** 把 options JSON 转成 `navigator.credentials.create` 的 `publicKey`；形状非法返回 undefined。 */
export function toCreationOptions(raw: unknown): PublicKeyCredentialCreationOptions | undefined {
  if (!isRecord(raw)) return undefined;
  const options = raw as unknown as CreationOptionsJson;
  if (typeof options.challenge !== "string") return undefined;
  if (!isRecord(options.rp) || !isRecord(options.user)) return undefined;
  if (typeof options.user.id !== "string") return undefined;
  if (!Array.isArray(options.pubKeyCredParams)) return undefined;
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: decodeBase64Url(options.challenge),
    rp: {
      name: String(options.rp.name ?? ""),
      ...(typeof options.rp.id === "string" ? { id: options.rp.id } : {}),
    },
    user: {
      id: decodeBase64Url(options.user.id),
      name: String(options.user.name ?? ""),
      displayName: String(options.user.displayName ?? ""),
    },
    pubKeyCredParams: options.pubKeyCredParams.map((param) => ({
      type: "public-key" as const,
      alg: param.alg,
    })),
  };
  if (typeof options.timeout === "number") publicKey.timeout = options.timeout;
  if (Array.isArray(options.excludeCredentials)) {
    publicKey.excludeCredentials = options.excludeCredentials.map((item) => ({
      type: "public-key" as const,
      id: decodeBase64Url(item.id),
      ...(Array.isArray(item.transports)
        ? { transports: item.transports as AuthenticatorTransport[] }
        : {}),
    }));
  }
  applyOptionalOptions(publicKey, options);
  return publicKey;
}

/** 可选字段：库透传什么就带什么，缺省不写（`exactOptionalPropertyTypes` 下不能写 undefined）。 */
function applyOptionalOptions(
  publicKey: PublicKeyCredentialCreationOptions,
  options: CreationOptionsJson,
): void {
  if (isRecord(options.authenticatorSelection)) {
    publicKey.authenticatorSelection = options.authenticatorSelection;
  }
  if (typeof options.attestation === "string") {
    // 库透传的是 JSON 字符串；DOM 类型是字面量联合，这里按契约收窄（服务端只发 none）。
    publicKey.attestation = options.attestation as AttestationConveyancePreference;
  }
  if (isRecord(options.extensions)) {
    publicKey.extensions = options.extensions;
  }
}

/** 认证器上报的 transports（逗号分隔，与 host 的 `parseTransports` 同口径）。 */
export function transportsOf(credential: PublicKeyCredential): string {
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = typeof response.getTransports === "function" ? response.getTransports() : [];
  return transports.join(",");
}

/** 用户取消（`NotAllowedError`）与超时都按「中止」处理：不显示错误，恢复按钮即可。 */
export function isCancelled(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error["name"] === "AbortError" || error["name"] === "NotAllowedError";
}
