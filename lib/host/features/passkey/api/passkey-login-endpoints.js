import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { methodNotAllowed, mountRoutes, setPasskeyPermissionsPolicy, } from "../../../shared/http/index.js";
import { PASSKEY_LOGIN_PATH, PASSKEY_OPTIONS_PATH, } from "../../../shared/protocol/index.js";
import { buildCeremonyCookie } from "../model/ceremony-cookie.js";
import { PasskeyCounterStore } from "../model/passkey-login.js";
import { handlePasskeyLogin } from "./passkey-login-finish.js";
import { sendOptionsLocked } from "./passkey-login-failures.js";
/** options 里的用户交互窗口（毫秒）；与 ceremony cookie 的 120 秒 TTL 对齐。 */
const OPTIONS_TIMEOUT_MS = 120_000;
/**
 * 两条登录路由（begin / finish）。两条 handler 共用同一个 `PasskeyCounterStore`：
 * 计数器只被 finish 使用，begin 只建 ceremony；拆出来供统一注册入口把登录与管理路由
 * 收进同一批 `mountRoutes`（部分失败一起回滚）。
 */
export function makePasskeyLoginRoutes(deps) {
    const counters = new PasskeyCounterStore();
    return [
        {
            kind: "exact",
            path: PASSKEY_OPTIONS_PATH,
            handler: (req, res) => handleOptions(deps, req, res),
        },
        {
            kind: "exact",
            path: PASSKEY_LOGIN_PATH,
            handler: (req, res) => handlePasskeyLogin(deps, counters, req, res),
        },
    ];
}
/** 只注册两条登录路由（合并 disposer；部分失败按注册逆序回滚）。 */
export function registerPasskeyLoginEndpoints(deps) {
    return mountRoutes(deps.register, makePasskeyLoginRoutes(deps));
}
/** begin：匿名生成 challenge（写进 ceremony），JSON 响应 + ceremony cookie。 */
async function handleOptions(deps, req, res) {
    setPasskeyPermissionsPolicy(res);
    if (req.method !== "POST") {
        methodNotAllowed(res, "POST");
        return;
    }
    const ip = deps.clientIp(req);
    // 配额必须**真正消耗**：只 check 不计数会被匿名方用无限 begin 挤出他人 ceremony（§5.5）。
    const quota = deps.optionsQuota.check(ip);
    if (!quota.allowed) {
        sendOptionsLocked(res, quota.retryAfterSeconds);
        deps.logger.info("passkey options rate limited");
        return;
    }
    deps.optionsQuota.consume(ip);
    // ceremony 先建：challenge 由我们的随机源生成并写进存储，库只负责编码成 base64url
    // （库自己也能生成，但那样 challenge 就不在 ceremony 里）。
    const ceremony = deps.ceremony.create({ kind: "login" });
    const options = await generateAuthenticationOptions({
        rpID: deps.settings.rpId,
        timeout: OPTIONS_TIMEOUT_MS,
        userVerification: "required",
        allowCredentials: [],
        challenge: new Uint8Array(ceremony.challenge),
    });
    const body = {
        challenge: options.challenge,
        rpId: options.rpId ?? deps.settings.rpId,
        timeout: options.timeout ?? OPTIONS_TIMEOUT_MS,
        userVerification: "required",
        allowCredentials: [],
    };
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", buildCeremonyCookie(ceremony.id, deps.cookieSecure));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}
