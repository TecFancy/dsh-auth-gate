/**
 * passkey 注册与删除（M6 PR3）：再认证 + `navigator.credentials.create` + 表单 POST。
 *
 * 注册必须带当前口令（+ 可选 TOTP 码）：会话本身不足以注册，这是「会话被劫 → 加后门
 * passkey」的唯一堵点。删除同样带再认证凭据（删最后一把时服务端强制校验）。
 */
import {
  encodeForm,
  PASSKEY_REGISTER_OPTIONS_PATH,
  PASSKEY_REGISTER_PATH,
  PASSKEY_REMOVE_PATH,
  type PasskeyRegistrationRequest,
  type PasskeyRemoveRequest,
} from "../../../shared/api/index.ts";
import { PASSKEY_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  describePasskeyFailure,
  isInvalidTotp,
  type PasskeyFormValues,
  type PasskeyMutationResult,
} from "../model/passkey-form.ts";
import {
  encodeBase64Url,
  isCancelled,
  isPasskeySupported,
  toCreationOptions,
  transportsOf,
} from "./passkey-codec.ts";
import { readJsonSafe } from "./passkey-http.ts";

const REGISTER_OPTIONS_TARGET = PASSKEY_REGISTER_OPTIONS_PATH;
const REGISTER_TARGET = PASSKEY_REGISTER_PATH;
const REMOVE_TARGET = PASSKEY_REMOVE_PATH;

/** 注册结果：成功 / 失败（含字段标红）/ 已中止 / 浏览器不支持。 */
export type RegisterPasskeyResult =
  | { kind: "ok" }
  | { kind: "failure"; message: string; fields: ("label" | "password" | "code")[] }
  | { kind: "unsupported" }
  | { kind: "aborted" };

/** 取注册 options（再认证凭据随请求一起发：会话本身不足以注册）。 */
function fetchRegisterOptions(values: PasskeyFormValues, signal: AbortSignal): Promise<Response> {
  return fetch(REGISTER_OPTIONS_TARGET, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: encodeForm({ label: values.label.trim(), password: values.password, code: values.code }),
    signal,
    credentials: "same-origin",
  });
}

/** 把 create 的结果与再认证凭据一起 POST 到 register。 */
function postRegistration(
  values: PasskeyFormValues,
  credential: PublicKeyCredential,
  signal: AbortSignal,
): Promise<Response> {
  const response = credential.response as AuthenticatorAttestationResponse;
  const request: PasskeyRegistrationRequest = {
    label: values.label.trim(),
    password: values.password,
    code: values.code,
    id: credential.id,
    client_data_json: encodeBase64Url(response.clientDataJSON),
    attestation_object: encodeBase64Url(response.attestationObject),
    transports: transportsOf(credential),
  };
  return fetch(REGISTER_TARGET, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: encodeForm(request),
    signal,
    credentials: "same-origin",
  });
}

/** options 请求失败 → 失败视图（`invalid_totp` 单独指向验证码框）。 */
async function optionsFailure(res: Response, t: AccountTranslate): Promise<RegisterPasskeyResult> {
  const body = await readJsonSafe(res);
  const failure = describePasskeyFailure(res.status, body, t);
  const totp = isInvalidTotp(res.status, body);
  return {
    kind: "failure",
    message: totp ? t(PASSKEY_KEYS.invalidTotp) : failure.message,
    fields: totp ? ["code"] : failure.fields,
  };
}

/**
 * 注册一把新凭据：options（再认证）→ `navigator.credentials.create` → register。
 * 任一步失败都映射成同一种失败视图；用户取消/超时静默回退（`aborted`）。
 */
export async function registerPasskey(
  values: PasskeyFormValues,
  signal: AbortSignal,
  t: AccountTranslate,
): Promise<RegisterPasskeyResult> {
  if (!isPasskeySupported()) return { kind: "unsupported" };
  try {
    const optionsRes = await fetchRegisterOptions(values, signal);
    if (signal.aborted) return { kind: "aborted" };
    if (!optionsRes.ok) return await optionsFailure(optionsRes, t);
    const publicKey = toCreationOptions(await readJsonSafe(optionsRes));
    if (publicKey === undefined) {
      return { kind: "failure", message: t(PASSKEY_KEYS.generic), fields: [] };
    }
    const credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;
    if (signal.aborted) return { kind: "aborted" };
    if (credential === null) return { kind: "aborted" };
    const res = await postRegistration(values, credential, signal);
    if (signal.aborted) return { kind: "aborted" };
    if (res.ok) return { kind: "ok" };
    const body = await readJsonSafe(res);
    if (signal.aborted) return { kind: "aborted" };
    const failure = describePasskeyFailure(res.status, body, t);
    return { kind: "failure", message: failure.message, fields: failure.fields };
  } catch (error) {
    if (signal.aborted || isCancelled(error)) return { kind: "aborted" };
    return { kind: "failure", message: t(PASSKEY_KEYS.generic), fields: [] };
  }
}

/**
 * 删除一把凭据（按 `idPrefix` 前缀唯一匹配）。再认证凭据随请求一起发：
 * 删最后一把时服务端会强制校验，普通单删也带上（同一份表单，不区分路径）。
 */
export async function removePasskey(
  idPrefix: string,
  values: PasskeyFormValues,
  signal: AbortSignal,
  t: AccountTranslate,
): Promise<PasskeyMutationResult> {
  const request: PasskeyRemoveRequest = {
    id: idPrefix,
    password: values.password,
    code: values.code,
  };
  try {
    const res = await fetch(REMOVE_TARGET, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: encodeForm(request),
      signal,
      credentials: "same-origin",
    });
    if (signal.aborted) return { kind: "aborted" };
    if (res.ok) return { kind: "ok" };
    const body = await readJsonSafe(res);
    if (signal.aborted) return { kind: "aborted" };
    return { kind: "failure", failure: describePasskeyFailure(res.status, body, t) };
  } catch {
    return signal.aborted
      ? { kind: "aborted" }
      : { kind: "failure", failure: { message: t(PASSKEY_KEYS.generic), fields: [] } };
  }
}
