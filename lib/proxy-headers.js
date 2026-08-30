/**
 * 认证本地代理（dsh-auth proxy）——纯头/策略助手。
 *
 * 职责边界：HTTP 头过滤（hop-by-hop、Set-Cookie 属性改写）、回环监听校验、
 * Bearer 提取。全部为纯函数，便于独立测试；网络转发在 `./proxy.js`。
 */
/** RFC 7230 hop-by-hop 头：转发时逐一移除（大小写不敏感）。 */
export const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);
/** 判定回环监听主机名（与 dsh 的 isLoopbackHostname 同形）。 */
export function isLoopbackHostname(hostname) {
    if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1")
        return true;
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts[0] !== "127")
        return false;
    return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** 从 `host:port` 拆出 hostname 与端口；端口缺省 8443，0 表示 OS 分配。 */
export function parseListen(authority) {
    const at = authority.lastIndexOf(":");
    if (at === -1)
        return { hostname: authority, port: 8443 };
    const port = Number(authority.slice(at + 1));
    if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error(`proxy: invalid listen port in ${JSON.stringify(authority)}`);
    return { hostname: authority.slice(0, at) || "127.0.0.1", port };
}
/**
 * 代理监听地址必须严格绑定回环：非回环监听会把"认证本地代理"暴露成
 * 局域网跳板（页面 origin 判定也依赖回环）。
 */
export function assertLoopbackListen(authority) {
    const { hostname, port } = parseListen(authority);
    if (!isLoopbackHostname(hostname))
        throw new Error(`proxy: --listen host ${JSON.stringify(hostname)} is not loopback; bind 127.0.0.1 only`);
    return { hostname, port };
}
/** 提取 `Authorization: Bearer <token>` 中的 token；缺失/格式不符 → undefined。 */
export function bearerOf(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    return match === null ? undefined : match[1];
}
/** 过滤请求头：取走 hop-by-hop 与由代理接管的主机类字段。 */
export function filterRequestHeaders(headers) {
    const out = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined || value === "")
            continue;
        const lower = name.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower) || lower === "host")
            continue;
        out[name] = value instanceof Array ? value.join(", ") : value;
    }
    return out;
}
/** 过滤响应头：去掉 hop-by-hop；Set-Cookie 按需去掉 `Secure`。 */
export function filterResponseHeaders(headers, stripSecureCookie) {
    const out = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined)
            continue;
        const lower = name.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower))
            continue;
        out[name] =
            lower === "set-cookie" && stripSecureCookie
                ? rewriteSetCookie([value].flat().filter((v) => typeof v === "string"))
                : value;
    }
    return out;
}
/**
 * 升级响应的头过滤：`upgrade`/`connection` 是 101 协商的必要部分，必须保留；
 * 其余 hop-by-hop 头（transfer-encoding 等）仍剔除，Set-Cookie 适配同
 * {@link filterResponseHeaders}。
 */
export function filterUpgradeResponseHeaders(headers, stripSecureCookie) {
    const out = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined)
            continue;
        const lower = name.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower) && lower !== "upgrade" && lower !== "connection")
            continue;
        out[name] =
            lower === "set-cookie" && stripSecureCookie
                ? rewriteSetCookie([value].flat().filter((v) => typeof v === "string"))
                : value;
    }
    return out;
}
/**
 * 去掉 Set-Cookie 值里的 `Secure` 属性（仅回环一跳，用于明文 http 浏览器的
 * Safari 兜底；HttpOnly/SameSite/Path/Max-Age 原样保留）。
 */
export function rewriteSetCookie(values) {
    return values.map((value) => value.replace(/;\s*Secure(?=\s*;|\s*$)/gi, ""));
}
//# sourceMappingURL=proxy-headers.js.map