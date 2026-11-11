import { makeAdminWiring } from "./admin-wiring.js";
import { makePasswordChangeWiring, registerPasswordEndpoints, verifyPassword, } from "./host/features/password/index.js";
import { registerAuthEndpoints, safeEqual } from "./host/features/token/index.js";
import { verifyTotpCode } from "./host/features/totp/index.js";
import { makeClientIpResolver, parseClientIpPolicy } from "./host/shared/http/index.js";
import { loadUsersFile } from "./host/entities/user/index.js";
/**
 * 端点注册（按 mode 二选一，包装后的 register；P26）。**立即执行注册**并返回合并
 * disposer（作为 ctx.effect 的 callback 返回值；不得再包一层函数，否则会被 cordis
 * 当作 disposer 存起来，注册永不发生，实测 404）。
 */
export function makeEndpointsWiring(input) {
    const { server, config, auth, resolveToken, launchTokenBridge, usersPath, limiter, replayGuard, challengeMacKey, log, } = input;
    const policy = parseClientIpPolicy(config.clientIpHeader, config.trustedProxyCidrs);
    const clientIp = makeClientIpResolver(policy, log);
    // 同一个 replayGuard 单例：登录与改密共用（D22；不同实例会放过同窗重放）。
    const replayCheck = (username, counter, code) => replayGuard.checkAndRecord(username, counter, code);
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
//# sourceMappingURL=endpoints-wiring.js.map