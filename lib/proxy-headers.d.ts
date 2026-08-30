/**
 * 认证本地代理（dsh-auth proxy）——纯头/策略助手。
 *
 * 职责边界：HTTP 头过滤（hop-by-hop、Set-Cookie 属性改写）、回环监听校验、
 * Bearer 提取。全部为纯函数，便于独立测试；网络转发在 `./proxy.js`。
 */
/** RFC 7230 hop-by-hop 头：转发时逐一移除（大小写不敏感）。 */
export declare const HOP_BY_HOP_HEADERS: Set<string>;
/** 判定回环监听主机名（与 dsh 的 isLoopbackHostname 同形）。 */
export declare function isLoopbackHostname(hostname: string): boolean;
/** 从 `host:port` 拆出 hostname 与端口；端口缺省 8443，0 表示 OS 分配。 */
export declare function parseListen(authority: string): {
    hostname: string;
    port: number;
};
/**
 * 代理监听地址必须严格绑定回环：非回环监听会把"认证本地代理"暴露成
 * 局域网跳板（页面 origin 判定也依赖回环）。
 */
export declare function assertLoopbackListen(authority: string): {
    hostname: string;
    port: number;
};
/** 提取 `Authorization: Bearer <token>` 中的 token；缺失/格式不符 → undefined。 */
export declare function bearerOf(authorization: string | undefined): string | undefined;
/** 过滤请求头：取走 hop-by-hop 与由代理接管的主机类字段。 */
export declare function filterRequestHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string>;
/** 过滤响应头：去掉 hop-by-hop；Set-Cookie 按需去掉 `Secure`。 */
export declare function filterResponseHeaders(headers: Record<string, string | string[] | undefined>, stripSecureCookie: boolean): Record<string, string | string[] | undefined>;
/**
 * 升级响应的头过滤：`upgrade`/`connection` 是 101 协商的必要部分，必须保留；
 * 其余 hop-by-hop 头（transfer-encoding 等）仍剔除，Set-Cookie 适配同
 * {@link filterResponseHeaders}。
 */
export declare function filterUpgradeResponseHeaders(headers: Record<string, string | string[] | undefined>, stripSecureCookie: boolean): Record<string, string | string[] | undefined>;
/**
 * 去掉 Set-Cookie 值里的 `Secure` 属性（仅回环一跳，用于明文 http 浏览器的
 * Safari 兜底；HttpOnly/SameSite/Path/Max-Age 原样保留）。
 */
export declare function rewriteSetCookie(values: string[]): string[];
//# sourceMappingURL=proxy-headers.d.ts.map