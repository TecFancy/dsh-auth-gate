/**
 * 断言校验接线：把我们的业务策略（userHandle、计数器、BE/BS）包在
 * `@simplewebauthn/server` 的 `verifyAuthenticationResponse` 外面。
 *
 * 库抛出的异常 message 可能内嵌断言原文（challenge、counter 值等），因此在这里统一吞成
 * 固定原因码；端点只把原因码写日志，响应恒为同一个 401。
 */
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import type { PasskeyRecord } from "../../../entities/user/index.js";
import {
  backupStateMatches,
  readAuthenticatorCounter,
  selectVerificationCounter,
  type PasskeyAssertion,
  type PasskeyCredentialMatch,
  type PasskeyLoginSettings,
} from "../model/passkey-login.js";

/**
 * 未知 credential 的等量工作密钥：一把固定的 P-256 COSE 公钥（`{1:2,3:-7,-1:1,-2:x,-3:y}`）。
 * 它没有对应私钥，因此断言永远验不过，但 CBOR/COSE 解析与一次 ECDSA 验证照常发生，
 * 让「凭据不存在」与「签名错误」的耗时可比较。
 */
const DUMMY_COSE_PUBLIC_KEY = Buffer.from(
  "pQECAyYgASFYIPsrEbz8XMvLdY6OlqufQgQacohnrsiJUcTy3BdeUaVAIlggEZwlLlke1jipV8_IB_EVPj-3nFoM3-nMpW7-PV6ojO8",
  "base64url",
);

/** 拒绝原因码（只进日志，不进响应）。 */
export type AssertionRejection =
  "user-handle-mismatch" | "counter-regression" | "verification-failed" | "backup-state-mismatch";

/** 校验结论：成功带上库返回的新计数器与可选的放行告警。 */
export type AssertionVerdict =
  | {
      readonly ok: true;
      readonly newCounter: number;
      readonly warn: "counter-regression" | undefined;
    }
  | { readonly ok: false; readonly reason: AssertionRejection };

/** `verifyPasskeyAssertion` 的输入。 */
export interface AssertionVerificationInput {
  readonly settings: PasskeyLoginSettings;
  readonly match: PasskeyCredentialMatch;
  readonly assertion: PasskeyAssertion;
  /** ceremony 里的 challenge（base64url），即 `expectedChallenge`。 */
  readonly challenge: string;
  /** 进程内生效的计数器（`PasskeyCounterStore.stored`）。 */
  readonly storedCounter: number;
}

/**
 * 校验一条登录断言：userHandle 属于该用户 → 计数器策略 → 库验签 → BE/BS 与记录一致。
 * 任何一步失败都返回原因码（不抛异常）；库的异常（含重放计数器、非法 CBOR/DER）归为
 * `verification-failed`。
 */
export async function verifyPasskeyAssertion(
  input: AssertionVerificationInput,
): Promise<AssertionVerdict> {
  const { settings, match, assertion, challenge, storedCounter } = input;
  if (match.user.passkeyUserHandle !== assertion.userHandle) {
    return { ok: false, reason: "user-handle-mismatch" };
  }
  const counter = selectVerificationCounter({
    stored: storedCounter,
    reported: readAuthenticatorCounter(assertion.authenticatorData),
    enforce: settings.enforceCounter,
    deviceBound: !match.record.be && !match.record.bs,
  });
  if (counter.rejection !== undefined) return { ok: false, reason: counter.rejection };

  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: toAuthenticationResponseJson(assertion),
      expectedChallenge: challenge,
      expectedOrigin: settings.origins,
      expectedRPID: settings.rpId,
      credential: toCredential(match.record, counter.counter),
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, reason: "verification-failed" };
  }
  if (!verified.verified) return { ok: false, reason: "verification-failed" };
  const { newCounter, credentialDeviceType, credentialBackedUp } = verified.authenticationInfo;
  if (!backupStateMatches(match.record, credentialDeviceType, credentialBackedUp)) {
    return { ok: false, reason: "backup-state-mismatch" };
  }
  return { ok: true, newCounter, warn: counter.warn };
}

/**
 * 未知（或已禁用）凭据的等量工作：用固定 dummy 公钥把同一条断言完整验一遍，结果丢弃。
 * 抛错也丢弃；调用方无论如何都回同一个 401。
 */
export async function runDummyVerification(input: {
  readonly settings: PasskeyLoginSettings;
  readonly assertion: PasskeyAssertion;
  readonly challenge: string;
}): Promise<void> {
  try {
    await verifyAuthenticationResponse({
      response: toAuthenticationResponseJson(input.assertion),
      expectedChallenge: input.challenge,
      expectedOrigin: input.settings.origins,
      expectedRPID: input.settings.rpId,
      credential: {
        id: input.assertion.id,
        publicKey: DUMMY_COSE_PUBLIC_KEY,
        counter: 0,
      },
      requireUserVerification: true,
    });
  } catch {
    // 等量工作没有结论可言；真实校验失败与这里共用同一个 401。
  }
}

/** 库的 JSON 形状；`rawId` 与 `id` 必须逐字一致（库会拒绝不一致的握手）。 */
function toAuthenticationResponseJson(assertion: PasskeyAssertion): AuthenticationResponseJSON {
  const response: AuthenticationResponseJSON = {
    id: assertion.id,
    rawId: assertion.id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
    },
  };
  if (assertion.userHandle !== undefined) response.response.userHandle = assertion.userHandle;
  return response;
}

/** 记录 → 库的凭据形状；`counter` 由计数器策略决定（`0` = 跳过库内的回退检查）。 */
function toCredential(record: PasskeyRecord, counter: number): WebAuthnCredential {
  return {
    id: record.credentialId,
    publicKey: Buffer.from(record.publicKeyCose, "base64url"),
    counter,
    transports: record.transports,
  };
}
