import { resolvePublicHost } from "./host.js";
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
export function checkRequestOrigin(req, publicHost) {
    if (headerValue(req, "sec-fetch-site").trim().toLowerCase() === SAME_ORIGIN) {
        return { ok: true, source: "sec-fetch-site" };
    }
    const origin = headerValue(req, "origin").trim();
    if (origin === "")
        return deny("missing");
    if (origin.toLowerCase() === "null")
        return deny("null");
    // 多个来源（`a, b`）等价于没有单一来源可比，直接拒（不做"任一匹配"的宽松解释）。
    if (origin.includes(","))
        return deny("multiple");
    const parsed = parseUrl(origin);
    if (parsed === undefined)
        return deny("malformed");
    if (parsed.pathname !== "/" ||
        parsed.search !== "" ||
        parsed.hash !== "" ||
        parsed.username !== "" ||
        parsed.password !== "") {
        return deny("malformed");
    }
    const expected = expectedOrigin(req, publicHost);
    if (expected === undefined)
        return deny("public-host-unconfigured");
    if (parsed.origin !== expected)
        return deny("mismatch");
    return { ok: true, source: "origin" };
}
/** 对外来源（`scheme://host[:port]`）；`publicHost` 未配置或无法解析 -> undefined。 */
function expectedOrigin(req, publicHost) {
    const configured = (publicHost ?? "").trim();
    if (configured === "")
        return undefined;
    const scheme = SCHEME_PREFIX.exec(configured)?.[1]?.toLowerCase();
    const host = resolvePublicHost(configured, undefined);
    if (host === "")
        return undefined;
    const transportScheme = isEncrypted(req.socket) ? "https" : "http";
    return parseUrl(`${scheme ?? transportScheme}://${host}`)?.origin;
}
/** `tls.TLSSocket.encrypted === true`；其它任何形状都按明文连接处理。 */
function isEncrypted(socket) {
    return (typeof socket === "object" &&
        socket !== null &&
        socket.encrypted === true);
}
function deny(detail) {
    return { ok: false, reason: "bad_origin", detail };
}
function parseUrl(value) {
    try {
        return new URL(value);
    }
    catch {
        return undefined;
    }
}
function headerValue(req, name) {
    const raw = req.headers[name];
    if (typeof raw === "string")
        return raw;
    if (Array.isArray(raw))
        return raw[0] ?? "";
    return "";
}
//# sourceMappingURL=origin.js.map