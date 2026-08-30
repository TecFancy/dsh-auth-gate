/**
 * 认证本地代理（dsh-auth proxy）的 HTTP/WS 透传转发器。
 *
 * 形态：用户机器上只监听回环的无状态反向代理；认证由服务端 auth-gate 完成
 * （登录页/会话 cookie 经本代理原样透传），本代理只负责"把 page origin 变成
 * 回环"与可控的头部适配。不做任何 Host/Origin 改写；生产链路由 Caddy 统一
 * 改写（见 docs/deployed/local-proxy_zh.md）。
 */
import { type Server } from "node:http";
export interface ProxyOptions {
    /** 浏览器连接入口，形如 `127.0.0.1:8443`；必须回环。 */
    listen: string;
    /** 上游 origin，如 `https://dsh.hi-ruofei.com` 或验证用 `http://127.0.0.1:3080`。 */
    target: string;
    /** 本地明文 http 时去掉转发 Set-Cookie 的 `Secure`。 */
    stripSecureCookie: boolean;
    /** 每请求附加 `X-Dsh-Proxy: 1`（Phase 2.1 服务端 deny-list 标记钩子）。 */
    markProxy: boolean;
    /** 设置后：所有经代理请求必须携带 `Authorization: Bearer <该值>`。 */
    localToken: string;
    /** 允许 `http://` 上游（仅本机验证场景）。 */
    unsafePlainTarget: boolean;
}
export interface ProxyListen {
    hostname: string;
    port: number;
}
/** 校验配置并返回监听地址（供 createProxyServer 复用）。 */
export declare function validateProxyOptions(options: ProxyOptions): ProxyListen;
/** 创建代理服务器（不启动监听；listen/close 由调用方控制，便于测试）。 */
export declare function createProxyServer(options: ProxyOptions, log?: (line: string) => void): Server;
//# sourceMappingURL=proxy.d.ts.map