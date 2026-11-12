/**
 * `POST /auth/passkey/register/options`（注册 begin）。
 *
 * 已登录 + **再认证**（当前口令，`totp !== "off"` 且用户有 secret 时还要验证码）后才签发
 * ceremony：会话本身不足以注册，这是「会话被劫 → 加后门 passkey」的唯一堵点（plan §5.7）。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { formField } from "../../../shared/http/index.js";
import type { PasskeyRegistrationRequest } from "../../../shared/protocol/index.js";
import { buildCeremonyCookie } from "../model/ceremony-cookie.js";
import {
  normalizePasskeyLabel,
  PASSKEY_SUPPORTED_ALGORITHMS,
} from "../model/passkey-management.js";
import type { AuthedPasskeyRequest, PasskeyManagementDeps } from "./passkey-management-deps.js";
import { passkeyManagementGate } from "./passkey-management-gate.js";
import { reauthenticate, sendPasskeyError } from "./passkey-management-http.js";

/** 注册 options 的交互窗口（毫秒）；与 ceremony cookie 的 120 秒 TTL 对齐。 */
const REGISTER_TIMEOUT_MS = 120_000;

/** 新用户 handle 的字节数（`randomBytes(32)`，规范要求无 PII）。 */
const USER_HANDLE_BYTES = 32;

/** 注册 begin 的已解析输入。 */
interface RegisterOptionsInput {
  readonly authed: AuthedPasskeyRequest;
  readonly label: string;
  readonly password: string;
  readonly code: string;
}

/** 注册 begin：门禁 → 再认证 → label 校验 → options + ceremony cookie。 */
export async function handleRegisterOptions(
  deps: PasskeyManagementDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const gate = await passkeyManagementGate(deps, req, res, {
    method: "POST",
    form: true,
    origin: true,
    limiter: true,
  });
  if (gate.kind === "handled") return;
  const { authed, params, ip } = gate.context;
  await issueRegistrationOptions(deps, res, ip, {
    authed,
    label: formField<PasskeyRegistrationRequest>(params, "label"),
    password: formField<PasskeyRegistrationRequest>(params, "password"),
    code: formField<PasskeyRegistrationRequest>(params, "code"),
  });
}

/** 再认证 + label 校验 + options 生成（失败一律 401 / 400，原因只进日志）。 */
async function issueRegistrationOptions(
  deps: PasskeyManagementDeps,
  res: ServerResponse,
  ip: string,
  input: RegisterOptionsInput,
): Promise<void> {
  const { authed } = input;
  const reauthOk = await reauthenticate(deps, authed.username, authed.user, {
    password: input.password,
    code: input.code,
  });
  if (!reauthOk) {
    deps.limiter.recordFailure(ip, authed.username);
    deps.logger.warn("passkey register options rejected: re-authentication failed");
    sendPasskeyError(res, 401, "unauthorized");
    return;
  }
  const label = normalizePasskeyLabel(input.label);
  if (label === undefined) {
    sendPasskeyError(res, 400, "bad_request", "invalid-label");
    return;
  }
  const userHandle =
    authed.user.passkeyUserHandle ?? randomBytes(USER_HANDLE_BYTES).toString("base64url");
  const ceremony = deps.ceremony.create({
    kind: "register",
    userId: authed.username,
    userHandle,
    label,
  });
  const options = await generateRegistrationOptions({
    rpName: deps.settings.rpName ?? "DeepSeek Harness",
    rpID: deps.settings.rpId,
    userName: authed.username,
    userID: new Uint8Array(Buffer.from(userHandle, "base64url")),
    challenge: new Uint8Array(ceremony.challenge),
    timeout: REGISTER_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: (authed.user.passkeys ?? []).map((record) => ({
      id: record.credentialId,
      transports: record.transports,
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [...PASSKEY_SUPPORTED_ALGORITHMS],
  });
  res.setHeader("cache-control", "no-store");
  res.setHeader("set-cookie", buildCeremonyCookie(ceremony.id, deps.cookieSecure));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(options));
}
