/**
 * WebAuthn 的浏览器侧编解码（M6 PR3）：base64url ↔ ArrayBuffer、库 options JSON →
 * `navigator.credentials.create` 的 `publicKey`、认证器 transports 提取、特性检测。
 *
 * 手写而不引 `@simplewebauthn/browser`：client bundle 保持零第三方依赖（与登录页同一约束）。
 * 这里不是安全边界（服务端用库校验），只是把 JSON 形状转成浏览器 API 要的二进制。
 *
 * options 是**线上数据**：逐字段白名单解析（C8）。只把认识的值转成浏览器 API 的类型，
 * 其余字段一律丢弃：不 `as` 成 DOM 类型，也不把库将来新增的字段悄悄透传给认证器。
 */
import { isRecord } from "../../../shared/api/index.ts";

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

/** 读字符串字段。 */
function readString(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

/** 读布尔字段。 */
function readBoolean(record: Record<string, unknown>, name: string): boolean | undefined {
  const value = record[name];
  return typeof value === "boolean" ? value : undefined;
}

/** 读数字字段。 */
function readNumber(record: Record<string, unknown>, name: string): number | undefined {
  const value = record[name];
  return typeof value === "number" ? value : undefined;
}

/** 只保留字符串项（数组之外的形状回空数组）。 */
function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 认证器 transport 白名单（DOM 的 `AuthenticatorTransport` 联合）。 */
function isTransport(value: string): value is AuthenticatorTransport {
  switch (value) {
    case "usb":
    case "nfc":
    case "ble":
    case "internal":
    case "hybrid":
    case "smart-card":
      return true;
    default:
      return false;
  }
}

/** transports 白名单解析：认识的留下，其余丢弃。 */
function readTransports(value: unknown): AuthenticatorTransport[] {
  return readStringArray(value).filter(isTransport);
}

/** `rp`：`name` 必填，`id` 可选。 */
function readRp(value: unknown): PublicKeyCredentialRpEntity | undefined {
  if (!isRecord(value)) return undefined;
  const name = readString(value, "name");
  if (name === undefined) return undefined;
  const id = readString(value, "id");
  return id === undefined ? { name } : { name, id };
}

/** `user`：`id`（base64url）必填，展示名缺失时以空串兜底（不阻断注册）。 */
function readUser(value: unknown): PublicKeyCredentialUserEntity | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value, "id");
  if (id === undefined) return undefined;
  return {
    id: decodeBase64Url(id),
    name: readString(value, "name") ?? "",
    displayName: readString(value, "displayName") ?? "",
  };
}

/** `pubKeyCredParams`：只认 `type === "public-key"` 且 `alg` 为数字的项；全非法则整项非法。 */
function readCredentialParams(value: unknown): PublicKeyCredentialParameters[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const params: PublicKeyCredentialParameters[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const alg = readNumber(item, "alg");
    if (readString(item, "type") === "public-key" && alg !== undefined) {
      params.push({ type: "public-key", alg });
    }
  }
  return params.length === 0 ? undefined : params;
}

/** 单个 `excludeCredentials` 项：`id` 必须是 base64url 字符串，rest 丢给白名单。 */
function readDescriptor(value: unknown): PublicKeyCredentialDescriptor | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value, "id");
  if (id === undefined) return undefined;
  const transports = readTransports(value["transports"]);
  const descriptor: PublicKeyCredentialDescriptor = {
    type: "public-key",
    id: decodeBase64Url(id),
  };
  if (transports.length > 0) descriptor.transports = transports;
  return descriptor;
}

/** `excludeCredentials` 白名单解析；数组之外/全非法时为 `undefined`（不下发该字段）。 */
function readExcludeCredentials(value: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const descriptors = value
    .map(readDescriptor)
    .filter((item): item is PublicKeyCredentialDescriptor => item !== undefined);
  return descriptors.length === 0 ? undefined : descriptors;
}

/** `authenticatorSelection`：只保留白名单内的已知键。 */
function readAuthenticatorSelection(value: unknown): AuthenticatorSelectionCriteria | undefined {
  if (!isRecord(value)) return undefined;
  const selection: AuthenticatorSelectionCriteria = {};
  const attachment = readString(value, "authenticatorAttachment");
  if (attachment === "platform" || attachment === "cross-platform") {
    selection.authenticatorAttachment = attachment;
  }
  const residentKey = readString(value, "residentKey");
  if (residentKey === "discouraged" || residentKey === "preferred" || residentKey === "required") {
    selection.residentKey = residentKey;
  }
  const requireResidentKey = readBoolean(value, "requireResidentKey");
  if (requireResidentKey !== undefined) selection.requireResidentKey = requireResidentKey;
  const userVerification = readString(value, "userVerification");
  if (
    userVerification === "discouraged" ||
    userVerification === "preferred" ||
    userVerification === "required"
  ) {
    selection.userVerification = userVerification;
  }
  return Object.keys(selection).length === 0 ? undefined : selection;
}

/** `attestation` 白名单。 */
function readAttestation(value: unknown): AttestationConveyancePreference | undefined {
  switch (value) {
    case "none":
    case "indirect":
    case "direct":
    case "enterprise":
      return value;
    default:
      return undefined;
  }
}

/** `extensions`：本插件只认 `credProps`（其余扩展不发给认证器）。 */
function readExtensions(value: unknown): AuthenticationExtensionsClientInputs | undefined {
  if (!isRecord(value)) return undefined;
  const credProps = readBoolean(value, "credProps");
  return credProps === undefined ? undefined : { credProps };
}

/**
 * 把服务端下发的 options JSON 转成 `navigator.credentials.create` 的 `publicKey`。
 *
 * 必需字段（`challenge`/`rp`/`user`/`pubKeyCredParams`）任一非法即返回 `undefined`
 * （调用方按 generic 失败处理）；可选字段逐项白名单校验，非法即不下发。
 */
export function toCreationOptions(raw: unknown): PublicKeyCredentialCreationOptions | undefined {
  if (!isRecord(raw)) return undefined;
  const challenge = readString(raw, "challenge");
  const rp = readRp(raw["rp"]);
  const user = readUser(raw["user"]);
  const pubKeyCredParams = readCredentialParams(raw["pubKeyCredParams"]);
  if (challenge === undefined || rp === undefined || user === undefined) return undefined;
  if (pubKeyCredParams === undefined) return undefined;

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: decodeBase64Url(challenge),
    rp,
    user,
    pubKeyCredParams,
  };
  const timeout = readNumber(raw, "timeout");
  if (timeout !== undefined) publicKey.timeout = timeout;
  const excludeCredentials = readExcludeCredentials(raw["excludeCredentials"]);
  if (excludeCredentials !== undefined) publicKey.excludeCredentials = excludeCredentials;
  const authenticatorSelection = readAuthenticatorSelection(raw["authenticatorSelection"]);
  if (authenticatorSelection !== undefined)
    publicKey.authenticatorSelection = authenticatorSelection;
  const attestation = readAttestation(raw["attestation"]);
  if (attestation !== undefined) publicKey.attestation = attestation;
  const extensions = readExtensions(raw["extensions"]);
  if (extensions !== undefined) publicKey.extensions = extensions;
  return publicKey;
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
