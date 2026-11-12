/**
 * passkey 端点的统一注册入口（7 条 exact 路由）：
 *
 * - 匿名登录：`POST /auth/passkey/options`、`POST /auth/passkey/login`（`passkey-login-*`）；
 * - 已登录注册：`POST /auth/passkey/register/options`、`POST /auth/passkey/register`；
 * - 已登录管理：`GET /auth/passkey`、`POST /auth/passkey/remove`；
 * - admin 设置：`GET/POST /auth/passkey/settings`。
 *
 * 登录与管理共用同一个 `CeremonyStore`、同一个限速器实例与同一份 `settings`；管理侧的
 * 再认证与写盘能力由 `management` 注入（features 之间不互相 import）。
 *
 * 每条路由的 `path` 都写成 `src/protocol` 的常量字面量（`host:check` 按此核对「每个契约
 * 路径恰好注册一次」），因此这里逐个注册而不是遍历一张表。
 */
import type { HttpHandler } from "../../../shared/guard/index.js";
import { methodNotAllowed } from "../../../shared/http/index.js";
import {
  PASSKEY_PATH,
  PASSKEY_REGISTER_OPTIONS_PATH,
  PASSKEY_REGISTER_PATH,
  PASSKEY_REMOVE_PATH,
  PASSKEY_SETTINGS_PATH,
} from "../../../shared/protocol/index.js";
import type { PasskeyLoginDeps } from "./passkey-login-endpoints.js";
import { registerPasskeyLoginEndpoints } from "./passkey-login-endpoints.js";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
import { handlePasskeyList, handlePasskeyRemove } from "./passkey-manage-endpoints.js";
import { handleRegisterFinish } from "./passkey-register-finish.js";
import { handleRegisterOptions } from "./passkey-register-options.js";
import {
  handlePasskeySettingsGet,
  handlePasskeySettingsPost,
} from "./passkey-settings-endpoints.js";

/**
 * 注册入口的完整依赖：登录两条路由的 deps + 管理侧 deps。
 *
 * `settings` 只取管理侧那一份（`PasskeyManagementSettings` 是 `PasskeyLoginSettings` 的
 * 超集，多一个可选的 `rpName`），因此用 `Omit` 而不是同时 extends 两个接口。
 */
export interface PasskeyEndpointsDeps
  extends Omit<PasskeyLoginDeps, "settings">, PasskeyManagementDeps {}

/**
 * 注册全部 7 条 passkey 路由并返回合并 disposer（按注册逆序释放）。
 * 登录两条由 `registerPasskeyLoginEndpoints` 注册（它自己持有计数器存储），其余五条在这里注册。
 */
export function registerPasskeyEndpoints(deps: PasskeyEndpointsDeps): () => void {
  const loginDisposer = registerPasskeyLoginEndpoints(deps);
  const disposers: (() => void)[] = [
    deps.register({
      kind: "exact",
      path: PASSKEY_REGISTER_OPTIONS_PATH,
      handler: (req, res) => handleRegisterOptions(deps, req, res),
    }),
    deps.register({
      kind: "exact",
      path: PASSKEY_REGISTER_PATH,
      handler: (req, res) => handleRegisterFinish(deps, req, res),
    }),
    deps.register({
      kind: "exact",
      path: PASSKEY_PATH,
      handler: (req, res) => handlePasskeyList(deps, req, res),
    }),
    deps.register({
      kind: "exact",
      path: PASSKEY_REMOVE_PATH,
      handler: (req, res) => handlePasskeyRemove(deps, req, res),
    }),
    deps.register({
      kind: "exact",
      path: PASSKEY_SETTINGS_PATH,
      handler: (req, res) => handlePasskeySettings(deps, req, res),
    }),
  ];
  return () => {
    for (const disposer of [...disposers].reverse()) disposer();
    loginDisposer();
  };
}

/**
 * `/auth/passkey/settings` 同时接受 GET 与 POST（webserver 无 method 路由，handler 内分发）。
 * 其它方法在这里就回 405 + `allow: GET, POST`，不落到 GET 分支的 `allow: GET`。
 */
function handlePasskeySettings(
  deps: PasskeyEndpointsDeps,
  req: Parameters<HttpHandler>[0],
  res: Parameters<HttpHandler>[1],
): void | Promise<void> {
  if (req.method === "POST") return handlePasskeySettingsPost(deps, req, res);
  if (req.method === "GET") return handlePasskeySettingsGet(deps, req, res);
  methodNotAllowed(res, "GET, POST");
}
