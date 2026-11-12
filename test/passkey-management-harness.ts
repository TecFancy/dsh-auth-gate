/**
 * 注册/管理/设置端点的单测 harness（与登录 harness 分开：`test/passkey-authenticator-harness.ts`
 * 已接近 250 行上限）。
 *
 * 提供：假路由表、内存 users 快照（`mutateUsers` 直接改它，等价于锁内写盘）、可注入的
 * 口令/TOTP 再认证、可观察的 settings 写回，以及一个能签发真实会话 cookie 的 `SessionStore`。
 */
import { SessionStore } from "../src/host/entities/session/index.js";
import type { PasskeyRecord, UserRecord, UsersSnapshot } from "../src/host/entities/user/index.js";
import {
  CeremonyStore,
  PasskeyOptionsQuota,
  type PasskeyEndpointsDeps,
} from "../src/host/features/passkey/index.js";
import type { HttpHandler } from "../src/host/shared/guard/index.js";
import { LoginRateLimiter } from "../src/host/shared/rate-limit/index.js";
import { MemTable } from "./token-endpoints-harness.js";
import {
  PasskeyAuthenticator,
  randomBase64Url,
  TEST_CLIENT_IP,
  TEST_ORIGIN,
  TEST_RP_ID,
} from "./passkey-authenticator-harness.js";

/** 测试口令（`verify` 只认它）。 */
export const TEST_PASSWORD = "s3cret-pw";

/** 测试 TOTP secret（base32）与它当前窗口的验证码。 */
export const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** 一条注册到假 server 的 exact 路由。 */
export interface ManagementRoute {
  readonly kind: "exact";
  readonly path: string;
  readonly handler: HttpHandler;
}

/** 一次 settings 写回。 */
export interface PersistCall {
  readonly enabled: boolean;
}

/** 管理端点单测的整套假依赖。 */
export interface ManagementHarness {
  readonly deps: PasskeyEndpointsDeps;
  readonly routes: ManagementRoute[];
  readonly logs: { level: string; message: unknown }[];
  readonly users: Map<string, UserRecord>;
  readonly ceremony: CeremonyStore;
  readonly limiter: LoginRateLimiter;
  readonly store: SessionStore;
  readonly persisted: PersistCall[];
  /** 当前条件 UI 值（`persistConditionalUi` 会改它）。 */
  conditionalUi(): boolean;
  /** 让 `mutateUsers` 抛错（写盘失败 → 503）。 */
  setWriteFailure(value: boolean): void;
  /** 让 `loadUsers` 抛错（读盘失败 → 503）。 */
  setUsersLoadFailure(value: boolean): void;
  /** 让 `persistConditionalUi` 抛错（仍应 200）。 */
  setPersistFailure(value: boolean): void;
  /** 让 TOTP 校验恒失败（错码/重放）。 */
  setTotpFailure(value: boolean): void;
  /** 签发一个会话并返回 cookie 头（`kind` 缺省 full）。 */
  issueSessionCookie(
    username: string,
    kind?: "full" | "password-change-only" | "bootstrap",
  ): Promise<string>;
}

/** 确定性随机源：ceremony 的 id/challenge 可预测且互不相同。 */
function deterministicRandom(): (bytes: number) => Uint8Array {
  let seed = 0;
  return (bytes) => {
    seed += 1;
    return Buffer.alloc(bytes, seed);
  };
}

/** 造一个用户记录（默认无 passkey、非 admin）。 */
export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    passwordHash: "scrypt$unused",
    disabled: false,
    passkeys: [],
    ...overrides,
  };
}

/** 造一条已注册凭据（`credentialId` 缺省随机 16 字节）。 */
export function makePasskeyRecord(overrides: Partial<PasskeyRecord> = {}): PasskeyRecord {
  return {
    credentialId: randomBase64Url(16),
    publicKeyCose: randomBase64Url(77),
    alg: -7,
    signCount: 0,
    aaguid: "",
    be: false,
    bs: false,
    uvInitialized: true,
    transports: ["internal"],
    label: "Test key",
    createdAt: 1,
    lastUsedAt: 0,
    ...overrides,
  };
}

/** 可变状态盒：deps 的闭包与 harness 的访问器共享同一份。 */
interface HarnessState {
  readonly routes: ManagementRoute[];
  readonly logs: { level: string; message: unknown }[];
  readonly users: Map<string, UserRecord>;
  readonly persisted: PersistCall[];
  readonly store: SessionStore;
  readonly ceremony: CeremonyStore;
  conditionalUi: boolean;
  writeFails: boolean;
  usersLoadFails: boolean;
  persistFails: boolean;
  totpFails: boolean;
}

/** 构造 deps（`users` 是可变快照，测试随时 `harness.users.set(...)`）。 */
function makeDeps(state: HarnessState): PasskeyEndpointsDeps {
  return {
    register: (route) => {
      state.routes.push(route);
      return () => undefined;
    },
    sessions: () => state.store,
    cookieName: "dsh_auth",
    cookieSecure: true,
    ceremony: state.ceremony,
    optionsQuota: new PasskeyOptionsQuota(),
    settings: {
      rpId: TEST_RP_ID,
      rpName: "DeepSeek Harness",
      origins: [TEST_ORIGIN],
      enforceCounter: false,
    },
    // 带 scheme：Origin 通道按 `publicHost` 推导期望来源（与 TEST_ORIGIN 一致）。
    publicHost: TEST_ORIGIN,
    loadUsers: () =>
      state.usersLoadFails
        ? Promise.reject(new Error("users file unavailable"))
        : Promise.resolve({ snapshot: { users: state.users }, missing: false }),
    clientIp: () => TEST_CLIENT_IP,
    limiter: new LoginRateLimiter(),
    issueSession: () => Promise.resolve(),
    logger: {
      error: (message) => state.logs.push({ level: "error", message }),
      warn: (message) => state.logs.push({ level: "warn", message }),
      info: (message) => state.logs.push({ level: "info", message }),
    },
    now: () => 1_700_000_000_000,
    totpMode: "optional",
    management: {
      mutateUsers: (mutator) => {
        if (state.writeFails) return Promise.reject(new Error("write failed"));
        const snapshot: UsersSnapshot = { users: state.users };
        return Promise.resolve(mutator(snapshot));
      },
      verify: (password) => Promise.resolve(password === TEST_PASSWORD),
      hash: () => Promise.resolve("scrypt$unused"),
      verifyTotp: (_secret, code) => (state.totpFails || code !== "123456" ? undefined : 42),
      replayCheck: () => !state.totpFails,
      conditionalUi: () => state.conditionalUi,
      persistConditionalUi: (enabled) => {
        if (state.persistFails) return Promise.reject(new Error("settings service unavailable"));
        state.conditionalUi = enabled;
        state.persisted.push({ enabled });
        return Promise.resolve();
      },
    },
  };
}

/** 构造 harness：deps + 可观察状态 + 会话签发。 */
export function makeManagementHarness(): ManagementHarness {
  const state: HarnessState = {
    routes: [],
    logs: [],
    users: new Map(),
    persisted: [],
    store: new SessionStore(new MemTable()),
    ceremony: new CeremonyStore({ random: deterministicRandom() }),
    conditionalUi: false,
    writeFails: false,
    usersLoadFails: false,
    persistFails: false,
    totpFails: false,
  };
  const deps = makeDeps(state);
  return {
    deps,
    routes: state.routes,
    logs: state.logs,
    users: state.users,
    ceremony: state.ceremony,
    limiter: deps.limiter,
    store: state.store,
    persisted: state.persisted,
    conditionalUi: () => state.conditionalUi,
    setWriteFailure: (value) => {
      state.writeFails = value;
    },
    setUsersLoadFailure: (value) => {
      state.usersLoadFails = value;
    },
    setPersistFailure: (value) => {
      state.persistFails = value;
    },
    setTotpFailure: (value) => {
      state.totpFails = value;
    },
    issueSessionCookie: async (username, kind = "full") => {
      const { token } = await state.store.create(username, 60_000, kind);
      return `dsh_auth=${token}`;
    },
  };
}

/** 按 path 取注册的 handler（未注册直接抛错）。 */
export function managementHandler(routes: ManagementRoute[], path: string): HttpHandler {
  const route = routes.find((candidate) => candidate.path === path);
  if (route === undefined) throw new Error(`route not found: ${path}`);
  return route.handler;
}

/** 造一个已注册该认证器凭据的用户（`passkeyUserHandle` 与凭据一致）。 */
export function userWithAuthenticator(
  authenticator: PasskeyAuthenticator,
  overrides: Partial<PasskeyRecord> = {},
): UserRecord {
  return makeUser({
    passkeyUserHandle: authenticator.userHandle,
    passkeys: [
      makePasskeyRecord({
        credentialId: authenticator.credentialId,
        publicKeyCose: authenticator.publicKeyCose,
        ...overrides,
      }),
    ],
  });
}
