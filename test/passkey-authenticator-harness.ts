/**
 * 测试专用 WebAuthn 认证器（EC P-256，单文件、零依赖）。
 *
 * 只实现断言（get）方向的最小集合：自造 COSE 公钥（手写 canonical CBOR）、组装
 * authenticatorData、按 `sha256(authData || sha256(clientDataJSON))` 做 ECDSA/DER 签名。
 * 集成测试把它当真实认证器用，单元测试用它造「签名错 / counter 回退 / BE 不一致」等样本。
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { SessionStore } from "../src/host/entities/session/index.js";
import type { UserRecord } from "../src/host/entities/user/index.js";
import { CeremonyStore, type PasskeyLoginDeps } from "../src/host/features/passkey/index.js";
import type { HttpHandler } from "../src/host/shared/guard/index.js";
import { LoginRateLimiter } from "../src/host/shared/rate-limit/index.js";
import { MemTable } from "./token-endpoints-harness.js";

/** 断言提交给 `/auth/passkey/login` 的 urlencoded 扁平字段。 */
export interface PasskeyAssertionForm {
  readonly id: string;
  readonly client_data_json: string;
  readonly authenticator_data: string;
  readonly signature: string;
  readonly user_handle?: string;
}

/** 认证器构造参数：RP ID 决定 rpIdHash，credentialId/userHandle 用 base64url。 */
export interface PasskeyAuthenticatorOptions {
  readonly rpId: string;
  readonly userHandle: string;
  readonly credentialId?: string;
}

/** 一次断言的可调参数（默认值即「一次正常登录」）。 */
export interface AssertionOptions {
  readonly challenge: string;
  readonly origin: string;
  /** 认证器计数器；默认 1。 */
  readonly counter?: number;
  /** authenticatorData 的 flags 字节；默认 0x05 = UP | UV（无 BE/BS）。 */
  readonly flags?: number;
  /** 覆盖 `user_handle`；`null` = 不带该字段。默认用构造时的 userHandle。 */
  readonly userHandle?: string | null;
  /** clientDataJSON 的 type 覆盖值；默认 `webauthn.get`。 */
  readonly type?: string;
  /** 破坏签名（DER 结构仍合法），用于「签名错 → 401」。 */
  readonly badSignature?: boolean;
}

/** N 字节随机数的无填充 base64url（credentialId / userHandle 的测试样本）。 */
export function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

const BASE64URL = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** canonical CBOR 头部（major type + 长度/值；测试样本都 < 65536）。 */
function cborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const buffer = Buffer.alloc(3);
  buffer[0] = (major << 5) | 25;
  buffer.writeUInt16BE(value, 1);
  return buffer;
}

/** CBOR 负整数（major type 1，值 = -1 - n）。 */
function cborNegative(value: number): Buffer {
  return cborHead(1, -1 - value);
}

/** CBOR bstr。 */
function cborBytes(bytes: Uint8Array): Buffer {
  return Buffer.concat([cborHead(2, bytes.length), Buffer.from(bytes)]);
}

/**
 * 公钥 → COSE 原始字节（`{1:2, 3:-7, -1:1, -2:x, -3:y}`，canonical 键序）。
 * 与 `users.yaml` 的 `publicKeyCose` 同形：base64url 的原始 COSE，不转 JWK。
 */
export function encodeCoseP256(publicKeyJwk: { readonly x?: string; readonly y?: string }): string {
  const x = Buffer.from(publicKeyJwk.x ?? "", "base64url");
  const y = Buffer.from(publicKeyJwk.y ?? "", "base64url");
  const cose = Buffer.concat([
    cborHead(5, 5),
    cborHead(0, 1),
    cborHead(0, 2), // 1: kty = EC2
    cborHead(0, 3),
    cborNegative(-7), // 3: alg = ES256
    cborNegative(-1),
    cborHead(0, 1), // -1: crv = P-256
    cborNegative(-2),
    cborBytes(x), // -2: x
    cborNegative(-3),
    cborBytes(y), // -3: y
  ]);
  return BASE64URL(cose);
}

/** 一把自造的 P-256 认证器：同一实例可重复断言（每次给不同 challenge/counter）。 */
export class PasskeyAuthenticator {
  /** base64url credentialId（与 `users.yaml` 记录逐字一致）。 */
  readonly credentialId: string;
  /** base64url 原始 COSE 公钥（写进 `users.yaml` 的 `publicKeyCose`）。 */
  readonly publicKeyCose: string;
  /** base64url 32 字节 user handle（写进 `users.yaml` 的 `passkeyUserHandle`）。 */
  readonly userHandle: string;
  private readonly rpId: string;
  private readonly privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];

  constructor(options: PasskeyAuthenticatorOptions) {
    this.rpId = options.rpId;
    this.userHandle = options.userHandle;
    this.credentialId = options.credentialId ?? randomBase64Url(16);
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.publicKeyCose = encodeCoseP256(publicKey.export({ format: "jwk" }));
  }

  /** 产出一条 `webauthn.get` 断言（字段名即表单体字段名）。 */
  assert(options: AssertionOptions): PasskeyAssertionForm {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: options.type ?? "webauthn.get",
        challenge: options.challenge,
        origin: options.origin,
        crossOrigin: false,
      }),
    );
    const authData = Buffer.concat([
      createHash("sha256").update(this.rpId).digest(),
      Buffer.from([options.flags ?? 0x05]),
      counterBytes(options.counter ?? 1),
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]),
      { key: this.privateKey, dsaEncoding: "der" },
    );
    if (options.badSignature === true) {
      const last = signature.length - 1;
      signature.writeUInt8(signature.readUInt8(last) ^ 0xff, last);
    }
    const userHandle = options.userHandle === undefined ? this.userHandle : options.userHandle;
    return {
      id: this.credentialId,
      client_data_json: BASE64URL(clientDataJSON),
      authenticator_data: BASE64URL(authData),
      signature: BASE64URL(signature),
      ...(userHandle === null ? {} : { user_handle: userHandle }),
    };
  }
}

/** 4 字节大端计数器。 */
function counterBytes(counter: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(counter >>> 0, 0);
  return buffer;
}

// ---------------------------------------------------------------------------
// 登录端点测试 harness（与认证器同文件：`test/` 之外的名额只留集成测试）
// ---------------------------------------------------------------------------

/** 测试用 RP ID / origin / 客户端 IP；deps.settings 与断言必须逐字一致。 */
export const TEST_RP_ID = "dsh.example.com";
export const TEST_ORIGIN = "https://dsh.example.com";
export const TEST_CLIENT_IP = "203.0.113.9";
export const TEST_SESSION_COOKIE = "dsh_auth=fake-session";

/** 一条注册到假 server 的 exact 路由。 */
export interface PasskeyRoute {
  readonly kind: "exact";
  readonly path: string;
  readonly handler: HttpHandler;
}

export interface PasskeyLogEntry {
  readonly level: "error" | "warn" | "info";
  readonly message: unknown;
}

/** 注入的 `issueSession` 收到的一次调用（成功路径断言用）。 */
export interface IssuedSessionCall {
  readonly username: string;
  readonly next: string;
  readonly extra: string[];
}

/** 登录端点单测的整套假依赖：路由、日志、用户表、ceremony、限速器都可用。 */
export interface PasskeyLoginHarness {
  readonly deps: PasskeyLoginDeps;
  readonly routes: PasskeyRoute[];
  readonly logs: PasskeyLogEntry[];
  readonly issued: IssuedSessionCall[];
  readonly users: Map<string, UserRecord>;
  readonly ceremony: CeremonyStore;
  readonly limiter: LoginRateLimiter;
  readonly store: SessionStore;
  setSessionsAvailable(value: boolean): void;
}

export interface PasskeyLoginHarnessOptions {
  readonly ceremony?: CeremonyStore;
  readonly enforceCounter?: boolean;
  readonly cookieSecure?: boolean;
}

/** 确定性随机源：ceremony 的 id/challenge 可预测且互不相同。 */
export function deterministicRandom(): (bytes: number) => Uint8Array {
  let seed = 0;
  return (bytes) => {
    seed += 1;
    return Buffer.alloc(bytes, seed);
  };
}

/** `issueSession` 的假实现：记录调用、清 ceremony cookie + 下发固定会话 cookie、302。 */
function fakeIssueSession(
  issued: IssuedSessionCall[],
  res: Parameters<PasskeyLoginDeps["issueSession"]>[0],
  _store: SessionStore,
  username: string,
  next: string,
  _user: UserRecord,
  extraSetCookie: string[],
): Promise<void> {
  issued.push({ username, next, extra: extraSetCookie });
  res.setHeader("cache-control", "no-store");
  res.setHeader("set-cookie", [...extraSetCookie, TEST_SESSION_COOKIE].join(", "));
  res.writeHead(302, { location: next });
  res.end();
  return Promise.resolve();
}

/** 构造 deps；`loadUsers` 每次返回当前 `users` 快照，测试随时 `harness.users.set(...)`。 */
export function makePasskeyLoginHarness(
  options: PasskeyLoginHarnessOptions = {},
): PasskeyLoginHarness {
  const routes: PasskeyRoute[] = [];
  const logs: PasskeyLogEntry[] = [];
  const issued: IssuedSessionCall[] = [];
  const users = new Map<string, UserRecord>();
  const store = new SessionStore(new MemTable());
  const ceremony = options.ceremony ?? new CeremonyStore({ random: deterministicRandom() });
  let sessionsAvailable = true;
  const deps: PasskeyLoginDeps = {
    register: (route) => {
      routes.push(route);
      return () => undefined;
    },
    sessions: () => (sessionsAvailable ? store : undefined),
    cookieSecure: options.cookieSecure ?? true,
    ceremony,
    settings: {
      rpId: TEST_RP_ID,
      origins: [TEST_ORIGIN],
      enforceCounter: options.enforceCounter ?? false,
    },
    publicHost: "dsh.example.com",
    loadUsers: () => Promise.resolve({ snapshot: { users }, missing: false }),
    clientIp: () => TEST_CLIENT_IP,
    limiter: new LoginRateLimiter(),
    issueSession: (res, sessionStore, username, next, user, extraSetCookie) =>
      fakeIssueSession(issued, res, sessionStore, username, next, user, extraSetCookie),
    logger: {
      error: (message) => logs.push({ level: "error", message }),
      warn: (message) => logs.push({ level: "warn", message }),
      info: (message) => logs.push({ level: "info", message }),
    },
    now: () => 1_000,
  };
  return {
    deps,
    routes,
    logs,
    issued,
    users,
    ceremony,
    limiter: deps.limiter,
    store,
    setSessionsAvailable: (value) => {
      sessionsAvailable = value;
    },
  };
}

/** 按 path 取注册的 handler（未注册直接抛错，测试失败点更清楚）。 */
export function routeHandler(routes: PasskeyRoute[], path: string): HttpHandler {
  const route = routes.find((candidate) => candidate.path === path);
  if (route === undefined) throw new Error(`route not found: ${path}`);
  return route.handler;
}
