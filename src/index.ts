import type { Context } from "@deepseek-ai/cordis";
import { randomBytes } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { TokenGate } from "./host/features/token/index.js";
import * as guard from "./host/shared/guard/index.js";
import { DisabledSessionSweeper, PasswordGate } from "./host/features/password/index.js";
import { makeBootstrapWiring } from "./bootstrap-wiring.js";
import { mountAuthRoutes } from "./auth-routes.js";
import { TotpReplayGuard } from "./host/features/totp/index.js";
import { DEFAULT_TRUSTED_PROXIES } from "./host/shared/http/index.js";
import { LoginRateLimiter } from "./host/shared/rate-limit/index.js";
import { defaultUsersFilePath, loadUsersFile } from "./host/entities/user/index.js";
import { makeLaunchTokenBridge } from "./launch-token-bridge.js";
import { makeTokenResolver } from "./token-resolver.js";
import { sessionDomainSpec, SessionStore } from "./host/entities/session/index.js";
import { telemetryConfigFields, wireTelemetry, type TelemetryFields } from "./telemetry-wiring.js";
import { passkeyConfigFields, wirePasskey, type PasskeyFields } from "./passkey-wiring.js";

/** 稳定 Cordis 插件名（host 组合行 id）。 */
export const name = "dsh-auth-gate";

/** 硬依赖：守卫包装 webServer 的路由表；storageDomain/credentials 软读（见 apply）。 */
export const inject = ["webServer"] as const;

export interface AuthConfig extends TelemetryFields, PasskeyFields {
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
   * 客户端 IP 请求头（D19）：**仅当**直连 peer ∈ `trustedProxyCidrs` 时读它当限速桶 key；
   * `""`（默认）= 一个头都不读，key = 归一化后的 `socket.remoteAddress`。
   * 同主机反代（Caddy / Cloudflare Tunnel / nginx / Docker host 网络）下必须配置
   * （`cf-connecting-ip` 或 `x-forwarded-for`），否则所有客户端共用一个锁定桶；
   * 任何一台设备错几次密码就会把整台实例锁在门外（issue #74）。
   */
  clientIpHeader: string;
  /**
   * 受信反代地址集合（CIDR，D19）：默认只信回环（`127.0.0.0/8`、`::1/128`）。
   * 非法项被丢弃并降级为「只信回环」，前缀 0（`0.0.0.0/0`、`::/0`，等于信任所有人）一律拒绝；
   * 降级只打 error 日志，不卸载守卫（配置写错绝不放宽、也不 fail-open）。
   */
  trustedProxyCidrs: string[];
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

// 不加 `z<AuthConfig>` 断言：`.volatile()` 把字段的输出类型包成盒子，断言形式不再成立。
// `apply` 的入参用 `AuthConfig` 描述校验后的形状（`installId` 是盒子，经 `get()` 读）。
export const Config = z.object({
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
  clientIpHeader: z.string().default(""),
  trustedProxyCidrs: z.array(z.string()).default([...DEFAULT_TRUSTED_PROXIES]),
  revokeSweepMs: z.natural().default(5000),
  totp: z.union([z.const("off"), z.const("optional"), z.const("required")]).default("off"),
  logoutOrder: z.natural().max(10000).default(1000),
  ...passkeyConfigFields,
  ...telemetryConfigFields,
});

/** 本插件提供的 auth 服务：门（可换流/测试注入）+ 会话层。 */
export interface AuthService {
  /** storageDomain 缺失时为 undefined（会话不可用但守卫照常挂载）。 */
  sessions: SessionStore | undefined;
  /** 可写：token 模式为 TokenGate、password 模式为 PasswordGate；测试注入假门。 */
  gate: guard.Gate;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    auth?: AuthService;
  }
}

/**
 * 会话层软接（M1 逻辑不变）：storageDomain 缺失 → error 日志后守卫照常挂载；
 * 存在 → effect 内 open domain，就绪后把 SessionStore 挂到 auth.sessions，再通知 `onReady`
 * （首次引导的启动清扫要等这一刻）。
 */
function mountSessionDomain(
  ctx: Context,
  auth: AuthService,
  log: { error(message: unknown): void; info(message: unknown): void },
  onReady?: (store: SessionStore) => void,
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
        const store = new SessionStore(domain.table("sessions"));
        auth.sessions = store;
        onReady?.(store);
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
 * 应用 auth 门：mode 分支（token: credentials 解析器 + TokenGate；password: PasswordGate +
 * usersPath + 限速器）→ auth 服务（一步成型，sessions 访问器闭包自引用 auth）→ 软接会话层 →
 * 包装 webServer 四类入口 → 注册 /auth 端点（按 mode 二选一）→ 启动自检（fail loud）。
 * apply 内无 await；password 模式不访问 credentials 服务。
 */
export function apply(ctx: Context, config: AuthConfig): void {
  const server = ctx.get("webServer") as unknown as guard.WrappableServer | undefined;
  if (server === undefined) return;
  const log = ctx.logger("dsh-auth-gate");
  const passkey = wirePasskey({ ...config, log });
  // 条件 UI 的运行期值：初始来自配置，admin 可在设置页改写（写回宿主 settings 服务）。
  let passkeyConditionalUi = passkey.settings.enabled ? passkey.settings.conditionalUi : false;

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

  const bootstrap = makeBootstrapWiring({
    ctx,
    server,
    config,
    auth,
    usersPath,
    launchTokenBridge,
    log,
  });
  const sessionDisposer = mountSessionDomain(ctx, auth, log, bootstrap.onSessionsReady);
  if (sessionDisposer !== undefined) ctx.effect(sessionDisposer, "dsh-auth-gate: session domain");

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

  // 匿名统计挂在「门已经放行」的接缝上：钩子只在守卫的 allow 分支被调用，不在门的判定路径上，
  // 也不在启动时调用（首个放行请求之后才可能发）；users.yaml 只在上报到期时读一次。
  const unwrap = guard.wrapServer(server, () => auth.gate, log, wireTelemetry(ctx, config));
  ctx.effect(() => unwrap, "dsh-auth-gate: guard unwrap");

  // 首次引导通道（`/auth/bootstrap` → `/auth/setup` → `/auth/continue`）：只在实例未配置时签发
  // 一次性 bootstrap 会话，向导完成后关窗。三条路径在 `/auth` 前缀内，门直接放行。
  ctx.effect(() => bootstrap.mount(), "dsh-auth-gate: bootstrap routes");

  mountAuthRoutes(ctx, {
    server,
    config,
    auth,
    usersPath,
    launchTokenBridge,
    passkey,
    resolveToken,
    limiter,
    replayGuard,
    challengeMacKey,
    conditionalUi: () => passkeyConditionalUi,
    setConditionalUi: (enabled) => {
      passkeyConditionalUi = enabled;
    },
    log,
  });

  const failures = guard.assertGuarded(server);
  if (failures.length > 0) {
    for (const failure of failures) log.error(`unwrapped entry: ${failure}`);
    throw new Error(`dsh-auth-gate: guard self-check failed: ${failures.join(", ")}`);
  }
}
