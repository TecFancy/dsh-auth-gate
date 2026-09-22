import type { Context } from "@deepseek-ai/cordis";
import { randomBytes } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { registerAuthEndpoints, safeEqual, TokenGate } from "./features/token/index.js";
import { wrapServer, type Gate, type WrappableServer } from "./gate/index.js";
import {
  DisabledSessionSweeper,
  PasswordGate,
  registerPasswordEndpoints,
  verifyPassword,
} from "./features/password/index.js";
import { TotpReplayGuard, verifyTotpCode } from "./features/totp/index.js";
import { LoginRateLimiter, defaultUsersFilePath, loadUsersFile } from "./shared/index.js";
import { assertGuarded } from "./gate/index.js";
import { makeLaunchTokenBridge } from "./launch-token-bridge.js";
import { sessionDomainSpec, SessionStore } from "./session/index.js";

/** 稳定 Cordis 插件名（host 组合行 id）。 */
export const name = "dsh-auth-gate";

/** 硬依赖：守卫包装 webServer 的路由表；storageDomain/credentials 软读（见 apply）。 */
export const inject = ["webServer"] as const;

export interface AuthConfig {
  /** 认证流：token（M2）/ password（M3）。 */
  mode: "token" | "password";
  /** 会话 TTL（秒）。 */
  sessionTtl: number;
  /** 会话 cookie 名。 */
  cookieName: string;
  /** 共享 token 的 credentials 引用名（环境变量名）；password 模式忽略。 */
  tokenRef: string;
  /** cookie 是否带 `; Secure`（http 测试/开发可关，M7）。 */
  cookieSecure: boolean;
  /** users.yaml 路径；`""` = 按 P6 解析默认路径。password 模式专用。 */
  usersFile: string;
  /**
   * 登录页反钓鱼身份块显示的 host（D14，形如 `dsh.example.com` 或 `host:port`）。
   * `""`（默认）= 回退请求头 Host。半外壳反代改写了 Host（Caddy
   * `header_up Host 127.0.0.1:3080`）时必须显式配置，否则卡片会渲染回环地址、
   * 与浏览器地址栏不一致。只决定展示文本，不参与任何鉴权判定。
   * 容器/URL 形态（`https://host/path`）会被归一化成 `host`。
   */
  publicHost: string;
  /**
   * 禁用用户会话的扫描间隔（毫秒，password 模式）：`dsh-auth user disable` 之后，
   * 该用户**已发出**的会话最多在这么久内被吊销（默认 5000）；`<= 0` 关闭周期扫描，
   * 退回 M3 行为（禁用只拦新登录）。
   */
  revokeSweepMs: number;
  /**
   * TOTP 两段式模式（M4 T4）：off 忽略 secret（纯密码）；optional 有 secret 的用户
   * 走两段式；required 全员必须两段式（无 secret 的用户登录失败，统一 401）。
   */
  totp: "off" | "optional" | "required";
  /**
   * 「退出登录」按钮在设置 → 通用设置 页的槽位 order（升序渲染，越大越靠底部）。
   * 默认 1000 已大于 dsh 自带条目（-25~20）与绝大多数第三方插件；如确有插件
   * 注册更大的 order，可在此显式调大。经 `/auth/status` 透传给 client 半边。
   */
  logoutOrder: number;
}

export const Config: z<AuthConfig> = z.object({
  mode: z.union([z.const("token"), z.const("password")]).default("token"),
  sessionTtl: z.natural().default(604800),
  cookieName: z.string().default("dsh_auth"),
  // pattern 与 dsh-credentials 的 credential-ref 模式一致，同时挡住空串（M2 规格 §4.6）。
  tokenRef: z
    .string()
    .pattern(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default("DSH_AUTH_TOKEN"),
  cookieSecure: z.boolean().default(true),
  usersFile: z.string().default(""),
  publicHost: z.string().default(""),
  revokeSweepMs: z.natural().default(5000),
  totp: z.union([z.const("off"), z.const("optional"), z.const("required")]).default("off"),
  logoutOrder: z.natural().max(10000).default(1000),
});

/** 本插件提供的 auth 服务：门（可换流/测试注入）+ 会话层。 */
export interface AuthService {
  /** storageDomain 缺失时为 undefined（会话不可用但守卫照常挂载）。 */
  sessions: SessionStore | undefined;
  /** 可写：token 模式为 TokenGate、password 模式为 PasswordGate；测试注入假门。 */
  gate: Gate;
}

/** credentials 服务的结构镜像（M2 spec §3.1）；本文件私有，不导出。 */
interface CredentialRefResolver {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    auth?: AuthService;
  }
}

/**
 * 构造凭证解析器（每次调用惰性取服务。实测 harness 并行挂载行，credentials 行可能在
 * 本行 apply 之后才就绪；每次 resolve 现取既是 M2 的 per-operation 语义，也天然规避
 * 竞态）。服务缺失 → 首次解析时 log.error（fail-closed）；解析失败 → log.error 并返回
 * undefined（登录/门都按"无凭证"处理）。
 */
function makeTokenResolver(
  ctx: Context,
  config: AuthConfig,
  log: { error(message: unknown): void },
): () => Promise<string | undefined> {
  let warnedMissing = false;
  return async () => {
    const credentials = ctx.get("credentials") as unknown as CredentialRefResolver | undefined;
    if (credentials === undefined) {
      if (!warnedMissing) {
        warnedMissing = true;
        log.error("credentials service is unavailable: gate denies everything (fail-closed)");
      }
      return undefined;
    }
    try {
      const resolved = await credentials.resolve(config.tokenRef);
      return resolved?.value;
    } catch (error) {
      log.error(
        `token resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined; // fail-closed：解析失败 = 无凭证
    }
  };
}

/**
 * 会话层软接（M1 逻辑不变）：storageDomain 缺失 → error 日志后守卫照常挂载；
 * 存在 → effect 内 open domain，就绪后把 SessionStore 挂到 auth.sessions。
 */
function mountSessionDomain(
  ctx: Context,
  auth: AuthService,
  log: { error(message: unknown): void; info(message: unknown): void },
): (() => () => Promise<void>) | undefined {
  const storageDomain = ctx.get("storageDomain");
  if (storageDomain === undefined) {
    log.error(
      "storage-domain is unavailable: session persistence is disabled (guards stay mounted)",
    );
    return undefined;
  }
  return () => {
    let closed = false;
    const opening = storageDomain.open(sessionDomainSpec);
    const ready = opening.then(
      (domain) => {
        if (closed) {
          void domain.close();
          return;
        }
        auth.sessions = new SessionStore(domain.table("sessions"));
        log.info("session domain opened: dsh_auth_sessions");
      },
      (error: unknown) => {
        log.error(
          `session domain open failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
    return async () => {
      closed = true;
      await ready.catch(() => undefined);
      const domain = await opening.catch(() => undefined);
      await domain?.close();
    };
  };
}

/**
 * 端点注册（按 mode 二选一，包装后的 register；P26）。**立即执行注册**并返回合并
 * disposer（作为 ctx.effect 的 callback 返回值；不得再包一层函数，否则会被 cordis
 * 当作 disposer 存起来，注册永不发生，实测 404）。
 */
function mountAuthEndpoints(
  server: WrappableServer,
  config: AuthConfig,
  auth: AuthService,
  resolveToken: (() => Promise<string | undefined>) | undefined,
  launchTokenBridge: () => Promise<string | undefined>,
  usersPath: string,
  limiter: LoginRateLimiter,
  replayGuard: TotpReplayGuard,
  challengeMacKey: Uint8Array,
  log: {
    error(message: unknown): void;
    info(message: unknown): void;
    warn(message: unknown): void;
  },
): () => void {
  return config.mode === "password"
    ? registerPasswordEndpoints({
        register: (route) => server.register(route), // 包装后的 register（增量保险路径）
        sessions: () => auth.sessions,
        cookieName: config.cookieName,
        cookieSecure: config.cookieSecure,
        sessionTtl: config.sessionTtl,
        usersPath,
        loadUsers: () => loadUsersFile(usersPath),
        publicHost: config.publicHost,
        verify: verifyPassword,
        limiter,
        totpMode: config.totp,
        verifyTotp: (secretB32, code, nowMs) => verifyTotpCode(secretB32, code, nowMs),
        replayCheck: (username, counter, code) =>
          replayGuard.checkAndRecord(username, counter, code),
        now: Date.now,
        challengeMacKey,
        launchTokenBridge,
        logoutOrder: config.logoutOrder,
        logger: log,
      })
    : registerAuthEndpoints({
        register: (route) => server.register(route),
        sessions: () => auth.sessions,
        cookieName: config.cookieName,
        cookieSecure: config.cookieSecure,
        sessionTtl: config.sessionTtl,
        logoutOrder: config.logoutOrder,
        publicHost: config.publicHost,
        validateToken: async (token) => {
          const stored = await (resolveToken ?? (() => Promise.resolve(undefined)))();
          return stored !== undefined && safeEqual(token, stored);
        },
        logger: log,
      });
}

/**
 * 应用 auth 门：mode 分支（token: credentials 解析器 + TokenGate；password: PasswordGate +
 * usersPath + 限速器）→ auth 服务（一步成型，sessions 访问器闭包自引用 auth）→ 软接会话层 →
 * 包装 webServer 四类入口 → 注册 /auth 端点（按 mode 二选一）→ 启动自检（fail loud）。
 * apply 内无 await；password 模式不访问 credentials 服务。
 */
export function apply(ctx: Context, config: AuthConfig): void {
  const server = ctx.get("webServer") as unknown as WrappableServer | undefined;
  if (server === undefined) return;
  const log = ctx.logger("dsh-auth-gate");

  const resolveToken = config.mode === "token" ? makeTokenResolver(ctx, config, log) : undefined;
  const launchTokenBridge = makeLaunchTokenBridge(ctx, log);
  const usersPath = config.usersFile === "" ? defaultUsersFilePath() : config.usersFile;
  const limiter = new LoginRateLimiter();
  const replayGuard = new TotpReplayGuard();
  // 挑战 cookie HMAC 密钥（D10）：进程级随机值，与 limiter / replayGuard 同寿命；
  // 重启/插件重载后在途挑战 cookie 失效（用户需重新输入密码，≤5 分钟窗口）。
  const challengeMacKey = randomBytes(32);

  const auth: AuthService = {
    sessions: undefined,
    gate:
      config.mode === "password"
        ? new PasswordGate({ sessions: () => auth.sessions, cookieName: config.cookieName })
        : new TokenGate({
            // token 模式下 makeTokenResolver 必返回函数；`??` 兜底仅类型对齐（不可达且 fail-closed）
            resolveToken: resolveToken ?? (() => Promise.resolve(undefined)),
            sessions: () => auth.sessions,
            cookieName: config.cookieName,
          }),
  };
  ctx.provide("auth", auth);

  const sessionDisposer = mountSessionDomain(ctx, auth, log);
  if (sessionDisposer !== undefined) {
    ctx.effect(sessionDisposer, "dsh-auth-gate: session domain");
  }

  // 禁用用户 → 已发会话即时失效（D8）：插件侧周期扫描 users.yaml，把变更落到会话表；
  // 门保持 P12 的同步零 IO 语义，CLI 也不需要访问会话存储。
  if (config.mode === "password" && config.revokeSweepMs > 0) {
    const sweeper = new DisabledSessionSweeper({
      sessions: () => auth.sessions,
      loadUsers: () => loadUsersFile(usersPath),
      intervalMs: config.revokeSweepMs,
      log,
    });
    ctx.effect(() => sweeper.start(), "dsh-auth-gate: disabled session sweeper");
  }

  const unwrap = wrapServer(server, () => auth.gate, log);
  ctx.effect(() => unwrap, "dsh-auth-gate: guard unwrap");

  ctx.effect(
    () =>
      mountAuthEndpoints(
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
      ),
    "dsh-auth-gate: auth endpoints",
  );

  const failures = assertGuarded(server);
  if (failures.length > 0) {
    for (const failure of failures) log.error(`unwrapped entry: ${failure}`);
    throw new Error(`dsh-auth-gate: guard self-check failed: ${failures.join(", ")}`);
  }
}
