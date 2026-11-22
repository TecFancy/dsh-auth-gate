import { methodNotAllowed, mountRoutes } from "../../../shared/http/index.js";
import { PASSKEY_PATH, PASSKEY_REGISTER_OPTIONS_PATH, PASSKEY_REGISTER_PATH, PASSKEY_REMOVE_PATH, PASSKEY_SETTINGS_PATH, } from "../../../shared/protocol/index.js";
import { makePasskeyLoginRoutes } from "./passkey-login-endpoints.js";
import { handlePasskeyList, handlePasskeyRemove } from "./passkey-manage-endpoints.js";
import { handleRegisterFinish } from "./passkey-register-finish.js";
import { handleRegisterOptions } from "./passkey-register-options.js";
import { handlePasskeySettingsGet, handlePasskeySettingsPost, } from "./passkey-settings-endpoints.js";
/**
 * 注册全部 7 条 passkey 路由并返回合并 disposer（按注册逆序释放）。
 * 登录两条由 `makePasskeyLoginRoutes` 产出（它自己持有计数器存储），与管理五条收进同一批
 * `mountRoutes`：任一条注册抛错时整批回滚，不留半套路由。
 */
export function registerPasskeyEndpoints(deps) {
    return mountRoutes(deps.register, [
        ...makePasskeyLoginRoutes(deps),
        {
            kind: "exact",
            path: PASSKEY_REGISTER_OPTIONS_PATH,
            handler: (req, res) => handleRegisterOptions(deps, req, res),
        },
        {
            kind: "exact",
            path: PASSKEY_REGISTER_PATH,
            handler: (req, res) => handleRegisterFinish(deps, req, res),
        },
        {
            kind: "exact",
            path: PASSKEY_PATH,
            handler: (req, res) => handlePasskeyList(deps, req, res),
        },
        {
            kind: "exact",
            path: PASSKEY_REMOVE_PATH,
            handler: (req, res) => handlePasskeyRemove(deps, req, res),
        },
        {
            kind: "exact",
            path: PASSKEY_SETTINGS_PATH,
            handler: (req, res) => handlePasskeySettings(deps, req, res),
        },
    ]);
}
/**
 * `/auth/passkey/settings` 同时接受 GET 与 POST（webserver 无 method 路由，handler 内分发）。
 * 其它方法在这里就回 405 + `allow: GET, POST`，不落到 GET 分支的 `allow: GET`。
 */
function handlePasskeySettings(deps, req, res) {
    if (req.method === "POST")
        return handlePasskeySettingsPost(deps, req, res);
    if (req.method === "GET")
        return handlePasskeySettingsGet(deps, req, res);
    methodNotAllowed(res, "GET, POST");
}
