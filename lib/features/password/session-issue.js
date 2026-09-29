import { buildSetCookie } from "../../session/index.js";
import { RESTRICTED_REDIRECT_PATH, RESTRICTED_SESSION_KIND, RESTRICTED_SESSION_TTL_SECONDS, } from "./restricted-session.js";
/**
 * 发会话（P14）：subject=username，每次登录新会话；成功 → 302 + set-cookie。
 * 正式会话：桥命中 → 302 到相对 `/?token=`（浏览器自动 mint dsh cookie；相对地址
 * 沿用当前 origin，不依赖请求 Host）；桥失败/未配置 → 保持原 302(next)，绝不阻塞
 * 登录成功。受限会话不参与桥，302 恒为 `/auth/password`。
 */
export async function issueSession(deps, res, store, username, options) {
    const restricted = options.restricted === true;
    const ttlSeconds = restricted ? RESTRICTED_SESSION_TTL_SECONDS : deps.sessionTtl;
    const kind = restricted ? RESTRICTED_SESSION_KIND : "full";
    const { token } = await store.create(username, ttlSeconds * 1000, kind);
    res.setHeader("cache-control", "no-store");
    const cookies = [
        ...(options.extraSetCookie ?? []),
        buildSetCookie(deps.cookieName, token, ttlSeconds, deps.cookieSecure),
    ];
    res.setHeader("set-cookie", cookies);
    let location = restricted ? RESTRICTED_REDIRECT_PATH : options.next;
    if (!restricted && deps.launchTokenBridge !== undefined) {
        try {
            location = (await deps.launchTokenBridge()) ?? location;
        }
        catch {
            deps.logger.warn("launch-token bridge failed; falling back to plain redirect");
        }
    }
    res.writeHead(302, { location });
    res.end();
    deps.logger.info(restricted ? "restricted session issued" : "session issued");
}
/**
 * 登录侧唯一签发入口：按用户记录的 `must_change_password` 决定受限与否。
 * **判定只看登录时刻读到的用户记录**；之后的每请求判定只信 `session.kind`
 * （gate 不读 users.yaml，见 restricted-session.ts）。
 */
export async function issueLoginSession(deps, res, store, username, next, user, extraSetCookie) {
    await issueSession(deps, res, store, username, {
        next,
        extraSetCookie,
        restricted: user?.mustChangePassword === true,
    });
}
//# sourceMappingURL=session-issue.js.map