import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { WrappableServer } from "./host/shared/guard/index.js";
import type { LaunchTokenBridge } from "./host/shared/http/index.js";
import { methodNotAllowed } from "./host/shared/http/index.js";
import {
  BOOTSTRAP_PATH,
  BOOTSTRAP_SESSION_KIND,
  CONTINUE_PATH,
  SETUP_PATH,
} from "./host/shared/protocol/index.js";
import { buildSetCookie, type SessionStore } from "./host/entities/session/index.js";
import { checkPasswordPolicy, mutateUsersFile, USERNAME_RE } from "./host/entities/user/index.js";
import { hashPassword } from "./host/features/password/index.js";
import {
  makeBootstrapEndpoint,
  makeConfiguredProbe,
  makeContinueEndpoint,
  makeSetupHandlers,
  type ConfiguredProbe,
  type SetupTokenOutcome,
} from "./host/features/bootstrap/index.js";
import { readLaunchToken } from "./launch-token-bridge.js";

/** `ctx.get("credentials")` 的结构镜像（dsh ≥ 0.2 的 `CredentialProvider` 的子集）。 */
interface CredentialsLike {
  resolve(ref: string): Promise<{ value: string } | undefined>;
  set?(ref: string, value: string): Promise<void>;
}

/** 与 `Config` 的 `tokenRef` 模式一致：credential-ref 是 POSIX 环境变量名。 */
const CREDENTIAL_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 只看 bootstrap 需要的启动期配置（结构兼容 `AuthConfig`，根文件传整个 config 即可）。 */
export interface BootstrapConfig {
  mode: "token" | "password";
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number;
  tokenRef: string;
  publicHost: string;
}

export interface BootstrapWiringInput {
  ctx: Context;
  server: WrappableServer;
  config: BootstrapConfig;
  /** 会话层（异步就绪，每次现取）。 */
  auth: { sessions: SessionStore | undefined };
  usersPath: string;
  launchTokenBridge: LaunchTokenBridge;
  log: {
    info(message: unknown): void;
    warn(message: unknown): void;
    error(message: unknown): void;
  };
}

export interface BootstrapWiring {
  /** 注册三条路由（`/auth/bootstrap`、`/auth/setup`、`/auth/continue`），返回合并 disposer。 */
  mount: () => () => void;
  probe: ConfiguredProbe;
  /** 进程内「已配置」标志：向导写入成功后置位，探针立即改口，不等服务端缓存刷新。 */
  markedConfigured: { value: boolean };
  /** 会话层就绪后的启动清扫：已配置实例上的残留 bootstrap 会话一律吊销。 */
  onSessionsReady: (store: SessionStore) => void;
}

/**
 * 首次引导通道的 root 侧装配（与 `admin-wiring.ts` 同性质，从 `src/index.ts` 拆出）。
 *
 * 三件事：把探针、三个端点与页面渲染收拢成 deps；把「生成并保存访问令牌 / 建管理员」这两个
 * 需要宿主能力的动作落成实现；注册路由并在会话层就绪时清掉残留的 bootstrap 会话。
 * **访问令牌绝不写日志**：只出现在提交结果页的 HTML 里（一次性展示）。
 *
 * 未配置探针**不用** `makeTokenResolver`：那个解析器把「服务缺失 / 解析抛错」都吞成
 * `undefined`，会让「凭据服务尚未就绪」误判成「实例未配置」，于是在已配置实例上开引导窗口、
 * 甚至让向导覆盖掉已存在的 DSH_AUTH_TOKEN。这里用严格读取器，失败一律上抛成 `unknown`。
 */
export function makeBootstrapWiring(input: BootstrapWiringInput): BootstrapWiring {
  const markedConfigured = { value: false };
  const markConfigured = (): void => {
    markedConfigured.value = true;
  };
  const probe = makeConfiguredProbe({
    mode: input.config.mode,
    resolveToken:
      input.config.mode === "token"
        ? makeStrictTokenReader(input.ctx, input.config.tokenRef)
        : undefined,
    usersPath: input.usersPath,
    markedConfigured,
  });
  const setup = makeSetupHandlers({
    mode: input.config.mode,
    probe,
    sessions: () => input.auth.sessions,
    cookieName: input.config.cookieName,
    cookieSecure: input.config.cookieSecure,
    sessionTtlSeconds: input.config.sessionTtl,
    publicHost: input.config.publicHost,
    tokenRef: input.config.tokenRef,
    usersPath: input.usersPath,
    saveToken: () => saveToken(input, markConfigured),
    createAdmin: (username, password) => createAdmin(input, markConfigured, username, password),
    issueFullSession: (subject, res) => issueFullSession(input, subject, res),
    logger: input.log,
  });
  const bootstrap = makeBootstrapEndpoint({
    probe,
    readLaunchToken: () => readLaunchToken(input.ctx),
    sessions: () => input.auth.sessions,
    cookieName: input.config.cookieName,
    cookieSecure: input.config.cookieSecure,
    sessionTtlSeconds: input.config.sessionTtl,
    logger: input.log,
  });
  const continueHandler = makeContinueEndpoint({
    sessions: () => input.auth.sessions,
    cookieName: input.config.cookieName,
    bridge: input.launchTokenBridge,
    logger: input.log,
  });
  const setupRoute = (req: IncomingMessage, res: ServerResponse): void | Promise<void> => {
    if (req.method === "GET") return setup.get(req, res);
    if (req.method === "POST") return setup.post(req, res);
    methodNotAllowed(res, "GET, POST");
  };
  return {
    probe,
    markedConfigured,
    mount(): () => void {
      const disposers = [
        input.server.register({ kind: "exact", path: BOOTSTRAP_PATH, handler: bootstrap }),
        input.server.register({ kind: "exact", path: SETUP_PATH, handler: setupRoute }),
        input.server.register({ kind: "exact", path: CONTINUE_PATH, handler: continueHandler }),
      ];
      return () => {
        for (const dispose of [...disposers].reverse()) dispose();
      };
    },
    onSessionsReady: (store: SessionStore): void => {
      void probe
        .state()
        .then(async (state) => {
          if (state !== "configured") return;
          const revoked = await store.revokeByKind(BOOTSTRAP_SESSION_KIND);
          if (revoked > 0) input.log.info(`stale bootstrap sessions revoked: ${revoked}`);
        })
        .catch(() => input.log.warn("bootstrap session sweep failed"));
    },
  };
}

/** 生成并保存访问令牌：写盘 → 读回比对 → 关窗。读不回新值也算保存成功（只是要重启）。 */
async function saveToken(
  input: BootstrapWiringInput,
  markConfigured: () => void,
): Promise<SetupTokenOutcome> {
  try {
    const credentials = credentialsOf(input.ctx);
    if (credentials === undefined || typeof credentials.set !== "function") {
      return { status: "failed" };
    }
    if (!CREDENTIAL_REF_RE.test(input.config.tokenRef)) return { status: "failed" };
    const token = randomBytes(32).toString("base64url");
    await credentials.set(input.config.tokenRef, token);
    const readable = await readBack(credentials, input.config.tokenRef, token);
    markConfigured();
    return readable ? { status: "saved", token } : { status: "saved-unreadable", token };
  } catch {
    return { status: "failed" };
  }
}

/**
 * 严格读取共享 token（只给未配置探针用）：每次现取凭据服务，**服务缺失或 resolve 抛错一律
 * 上抛**，由探针映射成 `unknown`（不引导）。只有「解析成功且值为空」才返回 `undefined`
 * （= 真的未配置）。与 `makeTokenResolver` 的差别就在这里：那边的吞错是给门的 fail-closed
 * 用的，不能拿来判断「有没有配置」。
 */
function makeStrictTokenReader(ctx: Context, tokenRef: string): () => Promise<string | undefined> {
  return async (): Promise<string | undefined> => {
    const credentials = credentialsOf(ctx);
    if (credentials === undefined) throw new Error("credentials service is unavailable");
    const resolved = await credentials.resolve(tokenRef);
    return resolved?.value;
  };
}

/** 凭据服务（惰性现取：harness 并行挂载行，服务可能晚于本行就绪）。 */
function credentialsOf(ctx: Context): CredentialsLike | undefined {
  return ctx.get("credentials") as CredentialsLike | undefined;
}

/** 读回刚写的值；读失败或服务有缓存 → false（调用方据此提示「重启后生效」）。 */
async function readBack(
  credentials: CredentialsLike,
  ref: string,
  token: string,
): Promise<boolean> {
  try {
    const resolved = await credentials.resolve(ref);
    return resolved?.value === token;
  } catch {
    return false;
  }
}

/** 建第一个管理员：用户名 → 口令策略 → scrypt 哈希 → 锁内写 users.yaml。 */
async function createAdmin(
  input: BootstrapWiringInput,
  markConfigured: () => void,
  username: string,
  password: string,
): Promise<"ok" | "conflict" | "invalid" | "failed"> {
  try {
    if (!USERNAME_RE.test(username)) return "invalid";
    if (!(await checkPasswordPolicy(password)).ok) return "invalid";
    const passwordHash = await hashPassword(password);
    const outcome = await mutateUsersFile(input.usersPath, (snapshot) => {
      if (snapshot.users.has(username)) return "conflict" as const;
      snapshot.users.set(username, { passwordHash, disabled: false, role: "admin" });
      return "ok" as const;
    });
    if (outcome === "ok") markConfigured();
    return outcome;
  } catch {
    return "failed";
  }
}

/** 向导完成的正式会话：与登录成功同形（cookie 属性、TTL 一致），失败只记日志不放宽。 */
async function issueFullSession(
  input: BootstrapWiringInput,
  subject: string,
  res: ServerResponse,
): Promise<void> {
  const store = input.auth.sessions;
  if (store === undefined) {
    input.log.error("setup completed but the session store is unavailable");
    return;
  }
  const ttl = input.config.sessionTtl;
  const issued = await store.create(subject, ttl * 1000, "full");
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "set-cookie",
    buildSetCookie(input.config.cookieName, issued.token, ttl, input.config.cookieSecure),
  );
}
