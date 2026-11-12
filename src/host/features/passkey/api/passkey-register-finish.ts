/**
 * `POST /auth/passkey/register`（注册 finish）：校验 attestation，并在**锁内**复核全局唯一性、
 * 每用户上限与 userHandle 后写盘（plan §5.4 的 TOCTOU 要求）。
 *
 * 顺序：门禁（含读 users，**先于** consume）→ consume ceremony（kind/userId 必须匹配）
 * → 库校验 → `BE=0 && BS=1` 拒绝 → 锁内复核 + 追加 → 200 摘要。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { cose, decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { formField } from "../../../shared/http/index.js";
import type { PasskeyRecord, UsersSnapshot } from "../../../entities/user/index.js";
import type { PasskeyRegistrationRequest, PasskeySummary } from "../../../shared/protocol/index.js";
import { clearCeremonyCookie, readCeremonyId } from "../model/ceremony-cookie.js";
import type { CeremonyRecord } from "../model/ceremony-store.js";
import {
  buildPasskeyRecord,
  canAddPasskey,
  parseTransports,
  PASSKEY_SUPPORTED_ALGORITHMS,
  toPasskeySummary,
  type PasskeyAlgorithm,
} from "../model/passkey-management.js";
import type { AuthedPasskeyRequest, PasskeyManagementDeps } from "./passkey-management-deps.js";
import { passkeyManagementGate } from "./passkey-management-gate.js";
import { nowOf, sendPasskeyError, sendPasskeyStoreUnavailable } from "./passkey-management-http.js";

/** 注册 finish 的已解析输入。 */
interface RegisterFinishInput {
  readonly authed: AuthedPasskeyRequest;
  readonly ceremony: CeremonyRecord;
  readonly label: string;
  readonly transports: string[];
  readonly response: {
    readonly id: string;
    readonly clientDataJSON: string;
    readonly attestationObject: string;
  };
}

/** 库校验结果（只保留落盘需要的字段）。 */
interface VerifiedAttestation {
  readonly credentialId: string;
  readonly publicKeyCose: string;
  readonly alg: PasskeyAlgorithm;
  readonly counter: number;
  readonly aaguid: string;
  readonly credentialDeviceType: "singleDevice" | "multiDevice";
  readonly credentialBackedUp: boolean;
}

/** 落盘结论：成功 / 唯一性冲突 / 超上限 / 写盘失败。 */
type PersistOutcome = "ok" | "conflict" | "limit" | "failed";

/** 注册 finish：门禁 → consume ceremony → 校验 → 写盘 → 200。 */
export async function handleRegisterFinish(
  deps: PasskeyManagementDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const gate = await passkeyManagementGate(deps, req, res, {
    method: "POST",
    form: true,
    origin: true,
    limiter: false,
  });
  if (gate.kind === "handled") return;
  const { authed, params } = gate.context;
  const ceremony = deps.ceremony.consume(readCeremonyId(req.headers.cookie) ?? "");
  if (ceremony?.kind !== "register" || ceremony.userId !== authed.username) {
    deps.logger.warn("passkey register rejected: ceremony missing, expired or not ours");
    // 记录已被 consume（或本就不存在）：留着 cookie 只会让下一次必然失败，顺手清掉。
    res.setHeader("set-cookie", clearCeremonyCookie(deps.cookieSecure));
    sendPasskeyError(res, 401, "unauthorized");
    return;
  }
  await finishRegistration(deps, res, {
    authed,
    ceremony,
    label: ceremony.label ?? "",
    transports: parseTransports(formField<PasskeyRegistrationRequest>(params, "transports")),
    response: {
      id: formField<PasskeyRegistrationRequest>(params, "id"),
      clientDataJSON: formField<PasskeyRegistrationRequest>(params, "client_data_json"),
      attestationObject: formField<PasskeyRegistrationRequest>(params, "attestation_object"),
    },
  });
}

/** 库校验 + 业务校验 + 锁内写盘。 */
async function finishRegistration(
  deps: PasskeyManagementDeps,
  res: ServerResponse,
  input: RegisterFinishInput,
): Promise<void> {
  const verified = await verifyAttestation(deps, input);
  if (verified === undefined) {
    deps.logger.warn("passkey register rejected: attestation verification failed");
    sendPasskeyError(res, 401, "unauthorized");
    return;
  }
  if (verified.credentialDeviceType === "singleDevice" && verified.credentialBackedUp) {
    deps.logger.warn("passkey register rejected: BE=0 with BS=1");
    sendPasskeyError(res, 401, "unauthorized");
    return;
  }
  const record = buildPasskeyRecord({
    credentialId: verified.credentialId,
    publicKeyCose: verified.publicKeyCose,
    alg: verified.alg,
    signCount: verified.counter,
    aaguid: verified.aaguid,
    be: verified.credentialDeviceType === "multiDevice",
    bs: verified.credentialBackedUp,
    uvInitialized: true,
    transports: input.transports,
    label: input.label,
    createdAt: nowOf(deps)(),
  });
  const outcome = await persistPasskey(
    deps,
    input.authed.username,
    record,
    input.ceremony.userHandle,
  );
  if (outcome === "conflict") {
    sendPasskeyError(res, 400, "bad_request", "duplicate-credential");
    return;
  }
  if (outcome === "limit") {
    sendPasskeyError(res, 400, "bad_request", "too-many-passkeys");
    return;
  }
  if (outcome === "failed") {
    sendPasskeyStoreUnavailable(res);
    return;
  }
  const summary: PasskeySummary = toPasskeySummary(record);
  res.setHeader("cache-control", "no-store");
  res.setHeader("set-cookie", clearCeremonyCookie(deps.cookieSecure));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, passkey: summary }));
  deps.logger.info(
    `passkey registered: ${input.authed.username} (credential ${record.credentialId.slice(0, 8)})`,
  );
}

/** 调库校验 attestation；失败（含异常）返回 undefined，原因只进日志。 */
async function verifyAttestation(
  deps: PasskeyManagementDeps,
  input: RegisterFinishInput,
): Promise<VerifiedAttestation | undefined> {
  try {
    const verified = await verifyRegistrationResponse({
      response: {
        id: input.response.id,
        rawId: input.response.id,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: input.response.clientDataJSON,
          attestationObject: input.response.attestationObject,
        },
      },
      expectedChallenge: Buffer.from(input.ceremony.challenge).toString("base64url"),
      expectedOrigin: deps.settings.origins,
      expectedRPID: deps.settings.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: [...PASSKEY_SUPPORTED_ALGORITHMS],
    });
    if (!verified.verified) return undefined;
    const info = verified.registrationInfo;
    const alg = readCoseAlgorithm(info.credential.publicKey);
    if (alg === undefined) return undefined;
    return {
      credentialId: info.credential.id,
      publicKeyCose: Buffer.from(info.credential.publicKey).toString("base64url"),
      alg,
      counter: info.credential.counter,
      aaguid: info.aaguid,
      credentialDeviceType: info.credentialDeviceType,
      credentialBackedUp: info.credentialBackedUp,
    };
  } catch (error) {
    deps.logger.warn(
      `passkey register: attestation verification threw: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

/** 从 COSE 公钥读 `alg`（库的 helpers 子路径）；不在白名单 → undefined。 */
function readCoseAlgorithm(publicKey: Uint8Array): PasskeyAlgorithm | undefined {
  try {
    const decoded: number | undefined = decodeCredentialPublicKey(new Uint8Array(publicKey)).get(
      cose.COSEKEYS.alg,
    );
    return PASSKEY_SUPPORTED_ALGORITHMS.find((candidate) => candidate === decoded);
  } catch {
    return undefined;
  }
}

/**
 * 锁内写盘：在 mutator 里**重新**复核全局唯一性、每用户上限与 userHandle 存在性
 * （锁外预检不算数，plan §5.4 TOCTOU），然后追加记录。写盘异常 → `failed`（503）。
 */
async function persistPasskey(
  deps: PasskeyManagementDeps,
  username: string,
  record: PasskeyRecord,
  userHandle: string | undefined,
): Promise<PersistOutcome> {
  let outcome: PersistOutcome = "ok";
  try {
    await deps.management.mutateUsers((snapshot: UsersSnapshot) => {
      const user = snapshot.users.get(username);
      if (user === undefined) {
        outcome = "failed";
        return;
      }
      const existing = user.passkeys ?? [];
      if (existing.some((candidate) => candidate.credentialId === record.credentialId)) {
        outcome = "conflict";
        return;
      }
      if (!canAddPasskey(existing)) {
        outcome = "limit";
        return;
      }
      user.passkeys = [...existing, record];
      // 首次注册时把 ceremony 里生成的 handle 落盘（之后所有凭据共用它）。
      if (user.passkeyUserHandle === undefined && userHandle !== undefined) {
        user.passkeyUserHandle = userHandle;
      }
    });
  } catch (error) {
    deps.logger.error(
      `passkey register: write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "failed";
  }
  return outcome;
}
