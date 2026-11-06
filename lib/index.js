import { randomBytes } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { TokenGate } from "./host/features/token/index.js";
import * as guard from "./host/shared/guard/index.js";
import { DisabledSessionSweeper, PasswordGate } from "./host/features/password/index.js";
import { makeBootstrapWiring } from "./bootstrap-wiring.js";
import { makeEndpointsWiring } from "./endpoints-wiring.js";
import { TotpReplayGuard } from "./host/features/totp/index.js";
import { DEFAULT_TRUSTED_PROXIES } from "./host/shared/http/index.js";
import { LoginRateLimiter } from "./host/shared/rate-limit/index.js";
import { defaultUsersFilePath, loadUsersFile } from "./host/entities/user/index.js";
import { makeLaunchTokenBridge } from "./launch-token-bridge.js";
import { makeTokenResolver } from "./token-resolver.js";
import { sessionDomainSpec, SessionStore } from "./host/entities/session/index.js";
import { telemetryConfigFields, wireTelemetry } from "./telemetry-wiring.js";
/** 稳定 Cordis 插件名（host 组合行 id）。 */
export const name = "dsh-auth-gate";
/** 硬依赖：守卫包装 webServer 的路由表；storageDomain/credentials 软读（见 apply）。 */
export const inject = ["webServer"];
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
    ...telemetryConfigFields,
});
/**
 * 会话层软接（M1 逻辑不变）：storageDomain 缺失 → error 日志后守卫照常挂载；
 * 存在 → effect 内 open domain，就绪后把 SessionStore 挂到 auth.sessions，再通知 `onReady`
 * （首次引导的启动清扫要等这一刻）。
 */
function mountSessionDomain(ctx, auth, log, onReady) {
    const storageDomain = ctx.get("storageDomain");
    if (storageDomain === undefined) {
        log.error("storage-domain is unavailable: session persistence is disabled (guards stay mounted)");
        return undefined;
    }
    return () => {
        let closed = false;
        const opening = storageDomain.open(sessionDomainSpec);
        const ready = opening.then((domain) => {
            if (closed) {
                void domain.close();
                return;
            }
            const store = new SessionStore(domain.table("sessions"));
            auth.sessions = store;
            onReady?.(store);
            log.info("session domain opened: dsh_auth_sessions");
        }, (error) => {
            log.error(`session domain open failed: ${error instanceof Error ? error.message : String(error)}`);
        });
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
export function apply(ctx, config) {
    const server = ctx.get("webServer");
    if (server === undefined)
        return;
    const log = ctx.logger("dsh-auth-gate");
    const resolveToken = config.mode === "token" ? makeTokenResolver(ctx, config, log) : undefined;
    const launchTokenBridge = makeLaunchTokenBridge(ctx, log);
    const usersPath = config.usersFile === "" ? defaultUsersFilePath() : config.usersFile;
    const limiter = new LoginRateLimiter();
    const replayGuard = new TotpReplayGuard();
    // 挑战 cookie HMAC 密钥（D10）：进程级随机值，与 limiter / replayGuard 同寿命；
    // 重启/插件重载后在途挑战 cookie 失效（用户需重新输入密码，≤5 分钟窗口）。
    const challengeMacKey = randomBytes(32);
    const auth = {
        sessions: undefined,
        gate: config.mode === "password"
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
    if (sessionDisposer !== undefined)
        ctx.effect(sessionDisposer, "dsh-auth-gate: session domain");
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
    ctx.effect(() => makeEndpointsWiring({
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
    }), "dsh-auth-gate: auth endpoints");
    const failures = guard.assertGuarded(server);
    if (failures.length > 0) {
        for (const failure of failures)
            log.error(`unwrapped entry: ${failure}`);
        throw new Error(`dsh-auth-gate: guard self-check failed: ${failures.join(", ")}`);
    }
}
//# sourceMappingURL=index.js.map