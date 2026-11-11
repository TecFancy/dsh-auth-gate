/**
 * passkey 登录端点装配：`POST /auth/passkey/options`（begin，JSON + ceremony cookie）的
 * 实现与两个 exact 路由的注册。finish 处理器在 `passkey-login-finish.ts`（守文件行数上限）。
 *
 * 响应纪律：全部 `cache-control: no-store`；begin 的 challenge 来自 `CeremonyStore` 的随机源
 * （先 create，再交给库编码）；限速桶由装配侧注入且与口令登录分开。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { HttpHandler } from "../../../shared/guard/index.js";
import { methodNotAllowed } from "../../../shared/http/index.js";
import {
  PASSKEY_LOGIN_PATH,
  PASSKEY_OPTIONS_PATH,
  type PasskeyLoginOptionsResponse,
} from "../../../shared/protocol/index.js";
import { buildCeremonyCookie } from "../model/ceremony-cookie.js";
import { PasskeyCounterStore } from "../model/passkey-login.js";
import { handlePasskeyLogin, type PasskeyLoginFinishDeps } from "./passkey-login-finish.js";
import { sendOptionsLocked } from "./passkey-login-failures.js";

export type { PasskeyLoginSettings } from "../model/passkey-login.js";

/** options 里的用户交互窗口（毫秒）；与 ceremony cookie 的 120 秒 TTL 对齐。 */
const OPTIONS_TIMEOUT_MS = 120_000;

/** 注册登录取的输入（root 侧装配把配置、存储与限速器收拢成这个形状）。 */
export interface PasskeyLoginDeps extends PasskeyLoginFinishDeps {
  register(route: { kind: "exact"; path: string; handler: HttpHandler }): () => void;
}

/**
 * 注册两个 exact 端点并返回合并 disposer（内部按注册逆序释放）。
 * 同一 `PasskeyCounterStore` 实例服务两个端点（只被 finish 使用）。
 */
export function registerPasskeyLoginEndpoints(deps: PasskeyLoginDeps): () => void {
  const counters = new PasskeyCounterStore();
  const disposers = [
    deps.register({
      kind: "exact",
      path: PASSKEY_OPTIONS_PATH,
      handler: (req, res) => handleOptions(deps, req, res),
    }),
    deps.register({
      kind: "exact",
      path: PASSKEY_LOGIN_PATH,
      handler: (req, res) => handlePasskeyLogin(deps, counters, req, res),
    }),
  ];
  return () => {
    for (const disposer of [...disposers].reverse()) disposer();
  };
}

/** begin：匿名生成 challenge（写进 ceremony），JSON 响应 + ceremony cookie。 */
async function handleOptions(
  deps: PasskeyLoginDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res, "POST");
    return;
  }
  const ip = deps.clientIp(req);
  const check = deps.limiter.check(ip, undefined);
  if (!check.allowed) {
    sendOptionsLocked(res, check.retryAfterSeconds);
    deps.logger.info("passkey options rate limited");
    return;
  }
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
  const body: PasskeyLoginOptionsResponse = {
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
