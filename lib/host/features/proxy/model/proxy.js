/**
 * 认证本地代理（dsh-auth proxy）的 HTTP/WS 透传转发器。
 *
 * 形态：用户机器上只监听回环的无状态反向代理；认证由服务端 auth-gate 完成
 * （登录页/会话 cookie 经本代理原样透传），本代理只负责"把 page origin 变成
 * 回环"与可控的头部适配。不做任何 Host/Origin 改写；生产链路由 Caddy 统一
 * 改写（见 docs/deployed/local-proxy_zh.md）。
 */
import { createServer, request as httpRequest, } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { assertLoopbackListen, bearerOf, filterRequestHeaders, filterResponseHeaders, filterUpgradeResponseHeaders, } from "./proxy-headers.js";
const CLIENT_TOKEN_DENY = "proxy: missing or invalid Bearer token";
const TARGET_FAILURE = "proxy: upstream failure";
function transportOf(target, unsafePlainTarget) {
    if (target.protocol === "https:")
        return httpsRequest;
    if (target.protocol === "http:" && unsafePlainTarget)
        return httpRequest;
    throw new Error(`proxy: target protocol ${JSON.stringify(target.protocol)} not allowed (use --unsafe-plain-target for http) or target missing`);
}
/** 校验配置并返回监听地址（供 createProxyServer 复用）。 */
export function validateProxyOptions(options) {
    const listen = assertLoopbackListen(options.listen);
    const target = new URL(options.target);
    if (target.origin === "null")
        throw new Error(`proxy: invalid target ${JSON.stringify(options.target)}`);
    transportOf(target, options.unsafePlainTarget);
    return listen;
}
function upstreamTarget(options) {
    return new URL(options.target);
}
/** 目标默认端口（URL.port 为空串时按协议取默认）。 */
function defaultPortOf(target) {
    return target.protocol === "https:" ? 443 : 80;
}
function upstreamRequestHead(options, req, upgrade) {
    const target = upstreamTarget(options);
    const headers = filterRequestHeaders({ ...req.headers });
    headers["host"] = target.host;
    if (options.markProxy)
        headers["x-dsh-proxy"] = "1";
    if (upgrade) {
        headers["connection"] = "Upgrade";
        headers["upgrade"] = req.headers.upgrade ?? "websocket";
        const key = req.headers["sec-websocket-key"];
        const version = req.headers["sec-websocket-version"];
        if (key !== undefined)
            headers["sec-websocket-key"] = String(key);
        if (version !== undefined)
            headers["sec-websocket-version"] = String(version);
        const protocol = req.headers["sec-websocket-protocol"];
        if (protocol !== undefined && protocol !== "")
            headers["sec-websocket-protocol"] = String(protocol);
        const extensions = req.headers["sec-websocket-extensions"];
        if (extensions !== undefined && extensions !== "")
            headers["sec-websocket-extensions"] = String(extensions);
    }
    const port = target.port === "" ? defaultPortOf(target) : Number(target.port);
    return {
        options: {
            method: upgrade ? "GET" : req.method,
            hostname: target.hostname,
            port,
            path: req.url,
            protocol: target.protocol,
        },
        headers,
    };
}
function tokenIfRequired(options) {
    return options.localToken !== "";
}
function authorized(req, options) {
    if (!tokenIfRequired(options))
        return true;
    return bearerOf(req.headers.authorization) === options.localToken;
}
function finishWith(res, status, text) {
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(text);
}
function forwardRequest(options, req, res, log) {
    req.on("error", () => res.destroy());
    res.on("error", () => req.destroy());
    if (!authorized(req, options)) {
        finishWith(res, 401, CLIENT_TOKEN_DENY);
        return;
    }
    const { options: head, headers } = upstreamRequestHead(options, req, false);
    const transport = transportOf(upstreamTarget(options), options.unsafePlainTarget);
    const upstream = transport({ ...head, headers }, (up) => {
        up.on("error", () => res.destroy());
        const out = filterResponseHeaders(up.headers, options.stripSecureCookie);
        res.writeHead(up.statusCode ?? 502, out);
        up.pipe(res);
    });
    upstream.on("error", () => {
        log(`error ${req.method ?? "-"} ${req.url ?? "-"}: upstream failure`);
        finishWith(res, 502, TARGET_FAILURE);
    });
    req.pipe(upstream);
}
function forwardUpgrade(options, req, clientSocket, clientHead, log) {
    clientSocket.on("error", () => clientSocket.destroy());
    if (!authorized(req, options)) {
        clientSocket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        clientSocket.destroy();
        return;
    }
    const { options: head, headers } = upstreamRequestHead(options, req, true);
    const transport = transportOf(upstreamTarget(options), options.unsafePlainTarget);
    const upstream = transport({ ...head, headers }, () => {
        /* 上游拒绝升级时走 response 分支 */
    });
    upstream.on("upgrade", (up, upSocket, upHead) => {
        const statusLine = `HTTP/1.1 ${up.statusCode ?? 101} ${up.statusMessage ?? "Switching Protocols"}\r\n`;
        clientSocket.write(statusLine);
        for (const [name, value] of Object.entries(filterUpgradeResponseHeaders(up.headers, options.stripSecureCookie))) {
            if (value === undefined)
                continue;
            clientSocket.write(`${name}: ${value instanceof Array ? value.join(", ") : value}\r\n`);
        }
        clientSocket.write("\r\n");
        if (clientHead.length > 0)
            upSocket.write(clientHead);
        if (upHead.length > 0)
            clientSocket.write(upHead);
        upSocket.on("error", () => clientSocket.destroy());
        clientSocket.on("error", () => upSocket.destroy());
        upSocket.pipe(clientSocket);
        clientSocket.pipe(upSocket);
    });
    upstream.on("response", (up) => {
        up.on("error", () => clientSocket.destroy());
        const statusLine = `HTTP/1.1 ${up.statusCode ?? 502} ${up.statusMessage ?? ""}\r\n`;
        clientSocket.write(statusLine);
        for (const [name, value] of Object.entries(filterUpgradeResponseHeaders(up.headers, options.stripSecureCookie))) {
            if (value === undefined)
                continue;
            clientSocket.write(`${name}: ${value instanceof Array ? value.join(", ") : value}\r\n`);
        }
        clientSocket.write("\r\n");
        up.pipe(clientSocket);
    });
    upstream.on("error", () => {
        log(`error upgrade ${req.url ?? "-"}: upstream failure`);
        clientSocket.destroy();
    });
    upstream.end();
}
/** 静默日志（默认值，测试下可关掉逐行进日志）。 */
const noopLog = (line) => {
    void line;
};
/** 创建代理服务器（不启动监听；listen/close 由调用方控制，便于测试）。 */
export function createProxyServer(options, log = noopLog) {
    validateProxyOptions(options);
    const server = createServer((req, res) => forwardRequest(options, req, res, log));
    server.on("upgrade", (req, socket, head) => forwardUpgrade(options, req, socket, head, log));
    return server;
}
//# sourceMappingURL=proxy.js.map