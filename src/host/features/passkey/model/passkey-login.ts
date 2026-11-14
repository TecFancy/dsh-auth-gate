/**
 * passkey 登录的业务策略（不碰 HTTP 响应、不碰校验库）：断言扁平字段的解析与上限、
 * 全局凭据查找、认证器计数器回退与 `BE`/`BS` 一致性判定。
 *
 * 每条规则的理由在 `docs/plans/passkey-login-plan_zh.md` §5.6、§5.8；端点只负责把它们
 * 接成 401/429/503 响应，库只负责 CBOR/COSE/签名。
 */
import type { PasskeyRecord, UserRecord, UsersSnapshot } from "../../../entities/user/index.js";
import { formField } from "../../../shared/http/index.js";
import type { PasskeyAssertionRequest } from "../../../shared/protocol/index.js";

/** 登录端点需要的 WebAuthn 参数子集（root 侧装配从 `PasskeySettings` 收窄）。 */
export interface PasskeyLoginSettings {
  readonly rpId: string;
  readonly origins: string[];
  readonly enforceCounter: boolean;
}

/**
 * 单个 base64url 字段的字符上限（16 KiB）。**不是**安全边界：整个表单体由
 * `parseFormBody` 限 `FORM_BODY_LIMIT`，这里只给库的解析成本一个显式上限。
 */
export const PASSKEY_FIELD_MAX_CHARS = 16 * 1024;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** 已通过存在性/长度/字符集校验的断言扁平字段（`PasskeyAssertionRequest` 的 wash 后形状）。 */
export interface PasskeyAssertion {
  readonly id: string;
  readonly clientDataJSON: string;
  readonly authenticatorData: string;
  readonly signature: string;
  /** `user_handle` 可缺席；缺席与空串等价。 */
  readonly userHandle: string | undefined;
}

/** 无填充 base64url 且长度在 `(0, maxChars]` 内。 */
export function isBase64Url(value: string): boolean {
  return value.length > 0 && value.length <= PASSKEY_FIELD_MAX_CHARS && BASE64URL_RE.test(value);
}

/**
 * 从表单体读断言：缺 `id`/`client_data_json`/`authenticator_data`/`signature` 之一、
 * 超限、或不是 base64url → `undefined`（端点一律回同一个 401，不区分缺哪个字段）。
 * `user_handle` 时间接决定「凭据属主」判定，缺席返回 `undefined`。
 */
export function readPasskeyAssertion(params: URLSearchParams): PasskeyAssertion | undefined {
  const id = formField<PasskeyAssertionRequest>(params, "id");
  const clientDataJSON = formField<PasskeyAssertionRequest>(params, "client_data_json");
  const authenticatorData = formField<PasskeyAssertionRequest>(params, "authenticator_data");
  const signature = formField<PasskeyAssertionRequest>(params, "signature");
  if (![id, clientDataJSON, authenticatorData, signature].every(isBase64Url)) return undefined;
  const userHandle = formField<PasskeyAssertionRequest>(params, "user_handle");
  if (userHandle !== "" && !isBase64Url(userHandle)) return undefined;
  return {
    id,
    clientDataJSON,
    authenticatorData,
    signature,
    userHandle: userHandle === "" ? undefined : userHandle,
  };
}

/** 命中的凭据及其属主；`users.yaml` 的 loader 保证 `credentialId` 全局唯一。 */
export interface PasskeyCredentialMatch {
  readonly username: string;
  readonly user: UserRecord;
  readonly record: PasskeyRecord;
}

/**
 * 在全部用户的 `passkeys[]` 里按 `credentialId` 找凭据。名字不是凭据输入（无用户名登录），
 * 所以这里只能全表找：未命中 = 未知凭据，端点等量工作后回同一个 401。
 */
export function findPasskeyCredential(
  snapshot: UsersSnapshot,
  credentialId: string,
): PasskeyCredentialMatch | undefined {
  for (const [username, user] of snapshot.users) {
    for (const record of user.passkeys ?? []) {
      if (record.credentialId === credentialId) return { username, user, record };
    }
  }
  return undefined;
}

/** 从 `authenticatorData` 读认证器计数器（固定 offset 33..37，大端）；短于 37 字节 → undefined。 */
export function readAuthenticatorCounter(authenticatorData: string): number | undefined {
  const bytes = Buffer.from(authenticatorData, "base64url");
  return bytes.length < 37 ? undefined : bytes.readUInt32BE(33);
}

/** 计数器判定：`counter` 交给校验库（`0` = 跳过库内的严格回退检查）。 */
export interface VerificationCounter {
  readonly counter: number;
  /** 非空 = 业务策略拒绝（原因码只进日志，不进响应）。 */
  readonly rejection: "counter-regression" | undefined;
  /** 非空 = 放行但要记 warn 的原因码（默认策略下计数器回退只告警）。 */
  readonly warn: "counter-regression" | undefined;
}

/** `selectVerificationCounter` 的输入；`reported` 来自认证器数据里的计数器。 */
export interface CounterInput {
  readonly stored: number;
  readonly reported: number | undefined;
  /** `passkeyEnforceCounter`。 */
  readonly enforce: boolean;
  /** 设备绑定凭据（`be=false && bs=false`）；同步 passkey 不参与回退拒绝。 */
  readonly deviceBound: boolean;
}

/**
 * 登录计数器策略（§5.8）：`reported === 0`（认证器不支持计数器）或 `stored === 0`
 * （首次使用）跳过；前进值交给库正常校验；**回退**只在设备绑定凭据且 `enforce` 时拒绝，
 * 否则放行（传 `counter: 0` 绕过库内的严格回退检查）并让端点记 warn。
 * `reported === stored > 0` 视为重放：交给库拒绝（库对 `<=` 抛错）。
 */
export function selectVerificationCounter(input: CounterInput): VerificationCounter {
  const { stored, reported, enforce, deviceBound } = input;
  if (reported === undefined || reported === 0 || stored === 0) {
    return { counter: 0, rejection: undefined, warn: undefined };
  }
  if (reported > stored) return { counter: stored, rejection: undefined, warn: undefined };
  if (reported < stored) {
    if (enforce && deviceBound)
      return { counter: 0, rejection: "counter-regression", warn: undefined };
    return { counter: 0, rejection: undefined, warn: "counter-regression" };
  }
  return { counter: stored, rejection: undefined, warn: undefined };
}

/** 认证器报告的设备类别（与 `@simplewebauthn/server` 的 `CredentialDeviceType` 同形）。 */
export type CredentialDeviceType = "singleDevice" | "multiDevice";

/**
 * `BE`/`BS` 登录一致性：库从认证器数据解析出的设备类别/备份状态必须与注册时记录一致。
 * 不一致意味着「同一 credentialId 在别的设备/备份状态上出现」，拒绝（§5.6 第 4 条）。
 */
export function backupStateMatches(
  record: PasskeyRecord,
  credentialDeviceType: CredentialDeviceType,
  credentialBackedUp: boolean,
): boolean {
  return (credentialDeviceType === "multiDevice") === record.be && credentialBackedUp === record.bs;
}

/**
 * 进程内计数器（§5.4：默认只存内存、不随每次登录写盘）。进程重启后回落到
 * `users.yaml` 的快照值；因此它只是尽力检测，不是克隆防护承诺。
 */
export class PasskeyCounterStore {
  private readonly counters = new Map<string, number>();

  /** 当前生效值：进程内更新优先，否则用读盘快照。 */
  stored(record: PasskeyRecord): number {
    return this.counters.get(record.credentialId) ?? record.signCount;
  }

  /** 只在前进时更新进程内值；返回更新后的生效值。 */
  advance(record: PasskeyRecord, reported: number): number {
    const current = this.stored(record);
    if (reported <= current) return current;
    this.counters.set(record.credentialId, reported);
    return reported;
  }
}
