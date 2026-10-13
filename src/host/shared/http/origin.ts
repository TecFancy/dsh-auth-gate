import type { IncomingMessage } from "node:http";
import { resolvePublicHost } from "./host.js";

/**
 * 已认证状态变更请求的同源校验（P2 §6 的 CSRF 纵深）。
 *
 * 只服务两条**已认证**的写路径：`POST /auth/users/password` 与 `POST /auth/password`。
 * 登录路径（未认证）**不覆盖**：那边失败会让全员锁死，风险与收益不成比例（契约 §10 残留）。
 *
 * 判定顺序（任一通过即放行，两者都缺则 fail-closed）：
 * 1. `Sec-Fetch-Site: same-origin`：浏览器强制设置、页面脚本无法伪造，是最可靠的来源证明。
 * 2. `Origin` 与 `publicHost` 解析出的对外来源**精确相等**（scheme + host + port 全比）。
 *
 * `publicHost` 未配置时**绝不用请求头 `Host` 兜底**：`Host` 可被客户端任意伪造，
 * 拿它比 `Origin` 等于给"跨站请求自带一对一致的 Host/Origin"开口子。此时只剩通道 1，
 * 于是脚本必须显式带 `Origin` 或 `Sec-Fetch-Site`（不给"什么头都不带就放行"的豁免）。
 */
export type OriginVerdict =
  | { readonly ok: true; readonly source: "sec-fetch-site" | "origin" }
  | { readonly ok: false; readonly reason: "bad_origin"; readonly detail: OriginFailure };

/** 拒绝原因（进审计字段，取值固定、无请求原文）。 */
export type OriginFailure =
  "missing" | "null" | "multiple" | "malformed" | "mismatch" | "public-host-unconfigured";

/**
 * 结构上兼容 `IncomingMessage`：只需要请求头，加上「本次连接是否 TLS」这一个事实。
 * `socket` 故意声明成 `unknown`（只会去读 `encrypted` 一个字段）：
 * `node:net` 的 `Socket` 并不声明 `encrypted`（只有 `tls.TLSSocket` 有），
 * 若声明成 `{ encrypted?: boolean }`，弱类型检查会因为「没有共同属性」而拒绝整个
 * `IncomingMessage`。
 */
export interface OriginCheckRequest {
  readonly headers: IncomingMessage["headers"];
  readonly socket?: unknown;
}

const SAME_ORIGIN = "same-origin";
const SCHEME_PREFIX = /^(https?):\/\//i;

/**
 * 校验一次请求的来源。`publicHost` 是插件配置（空串 = 未配置）。
 *
 * 注意 scheme 推导：`publicHost` 写了 `https://host` 就用它；只写 `host[:port]`
 * 时用本次连接的加密状态（`socket.encrypted`）。TLS 终止在反代（Caddy/nginx）后面时
 * 连接本身是明文，运营侧应把 `publicHost` 写成带 scheme 的形式，否则脚本走 `Origin`
 * 通道会 403（浏览器不受影响：它们恒带 `Sec-Fetch-Site: same-origin`）。
 */
export function checkRequestOrigin(req: OriginCheckRequest, publicHost: string): OriginVerdict {
  if (headerValue(req, "sec-fetch-site").trim().toLowerCase() === SAME_ORIGIN) {
    return { ok: true, source: "sec-fetch-site" };
  }
  const origin = headerValue(req, "origin").trim();
  if (origin === "") return deny("missing");
  if (origin.toLowerCase() === "null") return deny("null");
  // 多个来源（`a, b`）等价于没有单一来源可比，直接拒（不做"任一匹配"的宽松解释）。
  if (origin.includes(",")) return deny("multiple");
  const parsed = parseUrl(origin);
  if (parsed === undefined) return deny("malformed");
  if (
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return deny("malformed");
  }
  const expected = expectedOrigin(req, publicHost);
  if (expected === undefined) return deny("public-host-unconfigured");
  if (parsed.origin !== expected) return deny("mismatch");
  return { ok: true, source: "origin" };
}

/** 对外来源（`scheme://host[:port]`）；`publicHost` 未配置或无法解析 -> undefined。 */
function expectedOrigin(req: OriginCheckRequest, publicHost: string): string | undefined {
  const configured = (publicHost ?? "").trim();
  if (configured === "") return undefined;
  const scheme = SCHEME_PREFIX.exec(configured)?.[1]?.toLowerCase();
  const host = resolvePublicHost(configured, undefined);
  if (host === "") return undefined;
  const transportScheme = isEncrypted(req.socket) ? "https" : "http";
  return parseUrl(`${scheme ?? transportScheme}://${host}`)?.origin;
}

/** `tls.TLSSocket.encrypted === true`；其它任何形状都按明文连接处理。 */
function isEncrypted(socket: unknown): boolean {
  return (
    typeof socket === "object" &&
    socket !== null &&
    (socket as { encrypted?: unknown }).encrypted === true
  );
}

function deny(detail: OriginFailure): OriginVerdict {
  return { ok: false, reason: "bad_origin", detail };
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function headerValue(req: OriginCheckRequest, name: string): string {
  const raw = req.headers[name];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}
