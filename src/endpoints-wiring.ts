import { makeAdminWiring } from "./admin-wiring.js";
import {
  makePasswordChangeWiring,
  registerPasswordEndpoints,
  verifyPassword,
} from "./host/features/password/index.js";
import { registerAuthEndpoints, safeEqual } from "./host/features/token/index.js";
import { type TotpReplayGuard, verifyTotpCode } from "./host/features/totp/index.js";
import type { WrappableServer } from "./host/shared/guard/index.js";
import { makeClientIpResolver, parseClientIpPolicy } from "./host/shared/http/index.js";
import type { LoginRateLimiter } from "./host/shared/rate-limit/index.js";
import type { SessionStore } from "./host/entities/session/index.js";
import { loadUsersFile } from "./host/entities/user/index.js";

/**
 * `/auth` 端点的 root 侧装配（与 `admin-wiring.ts`、`bootstrap-wiring.ts` 同性质，从 `src/index.ts`
 * 拆出，守住 250 行文件上限）：按 mode 二选一，把包装后的 `register`、限速桶、防重放单例、
 * 挑战 cookie 密钥与日志收拢成端点 deps，root 只保留接线语义（建谁、按什么顺序建）。
 */

/** 只看端点注册需要的配置（结构兼容 `AuthConfig`，根文件传整个 config 即可）。 */
export interface EndpointsConfig {
  mode: "token" | "password";
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number;
  publicHost: string;
  clientIpHeader: string;
  trustedProxyCidrs: string[];
  totp: "off" | "optional" | "required";
  logoutOrder: number;
}

export interface EndpointsWiringInput {
  server: WrappableServer;
  config: EndpointsConfig;
  /** 会话层（异步就绪，每次现取）。 */
  auth: { sessions: SessionStore | undefined };
  /** token 模式的共享 token 解析器；password 模式为 undefined。 */
  resolveToken: (() => Promise<string | undefined>) | undefined;
  /** launch-token 桥：两种模式共用同一个实例（登录成功后换 dsh 的 browser-session cookie）。 */
  launchTokenBridge: () => Promise<string | undefined>;
  /** users.yaml 路径（`""` 已由 root 解析成默认路径）。 */
  usersPath: string;
  /** 登录限速器（password 模式用；与改密桶、管理桶互不影响）。 */
  limiter: LoginRateLimiter;
  /** 登录与改密共用的防重放单例（D22）。 */
  replayGuard: TotpReplayGuard;
  /** 挑战 cookie 的进程级 HMAC 密钥（D10）。 */
  challengeMacKey: Uint8Array;
  /** passkey 功能是否启用（`wirePasskey` 的结果；透传给 `/auth/status`，token 模式恒 false）。 */
  passkeyEnabled: boolean;
  /** 登录页是否渲染 passkey 入口（未启用时 undefined）；条件 UI 由 `conditionalUi` 控制。 */
  passkeyLogin?: { readonly enabled: boolean; readonly conditionalUi: boolean } | undefined;
  log: {
    error(message: unknown): void;
    info(message: unknown): void;
    warn(message: unknown): void;
  };
}

/**
 * 端点注册（按 mode 二选一，包装后的 register；P26）。**立即执行注册**并返回合并
 * disposer（作为 ctx.effect 的 callback 返回值；不得再包一层函数，否则会被 cordis
 * 当作 disposer 存起来，注册永不发生，实测 404）。
 */
export function makeEndpointsWiring(input: EndpointsWiringInput): () => void {
  const {
    server,
    config,
    auth,
    resolveToken,
    launchTokenBridge,
    usersPath,
    limiter,
    replayGuard,
    challengeMacKey,
    log,
  } = input;
  const policy = parseClientIpPolicy(config.clientIpHeader, config.trustedProxyCidrs);
  const clientIp = makeClientIpResolver(policy, log);
  // 同一个 replayGuard 单例：登录与改密共用（D22；不同实例会放过同窗重放）。
  const replayCheck = (username: string, counter: number, code: string): boolean =>
    replayGuard.checkAndRecord(username, counter, code);
  if (config.mode !== "password") {
    return registerAuthEndpoints({
      register: (route) => server.register(route),
      sessions: () => auth.sessions,
      cookieName: config.cookieName,
      cookieSecure: config.cookieSecure,
      sessionTtl: config.sessionTtl,
      logoutOrder: config.logoutOrder,
      passkeyEnabled: input.passkeyEnabled,
      publicHost: config.publicHost,
      validateToken: async (token) => {
        const stored = await (resolveToken ?? (() => Promise.resolve(undefined)))();
        return stored !== undefined && safeEqual(token, stored);
      },
      // 两种模式共用同一个桥实例；token 模式此前漏接，登录成功后拿不到 dsh 的
      // browser-session cookie（issue #99）。
      launchTokenBridge,
      logger: log,
    });
  }
  // P1 §5 改密接线：独立限速桶 + 锁内写盘入口 + hashPassword + 撤销会话，
  // 装配在 password 切片内（root 只保留接线语义）。恒定注入，不存在静默不注册。
  const passwordChange = makePasswordChangeWiring(usersPath, auth, replayCheck, log);
  const loadUsers = () => loadUsersFile(usersPath);
  return registerPasswordEndpoints({
    register: (route) => server.register(route), // 包装后的 register（增量保险路径）
    sessions: () => auth.sessions,
    cookieName: config.cookieName,
    cookieSecure: config.cookieSecure,
    sessionTtl: config.sessionTtl,
    usersPath,
    loadUsers,
    publicHost: config.publicHost,
    verify: verifyPassword,
    limiter,
    clientIp,
    totpMode: config.totp,
    verifyTotp: (secretB32, code, nowMs) => verifyTotpCode(secretB32, code, nowMs),
    replayCheck,
    now: Date.now,
    challengeMacKey,
    launchTokenBridge,
    logoutOrder: config.logoutOrder,
    passkey: input.passkeyLogin,
    logger: log,
    passwordChange,
    // P2 管理面：装配细节（第三个独立限流桶、锁内写盘、吊销探针、双桶清理）在
    // `src/admin-wiring.ts`；三条已认证路径共用同一个 replayGuard 单例。
    admin: makeAdminWiring({
      sessions: () => auth.sessions,
      cookieName: config.cookieName,
      usersPath,
      publicHost: config.publicHost,
      clientIp,
      limiter,
      passwordChangeLimiter: passwordChange.limiter,
      replayCheck,
      log,
    }),
  });
}
