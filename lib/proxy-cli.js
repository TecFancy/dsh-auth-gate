#!/usr/bin/env node
/**
 * dsh-auth-proxy CLI：认证本地代理入口。
 *
 * 用法示例：
 *   dsh-auth-proxy --listen 127.0.0.1:8443 --target https://dsh.example.com
 */
import { pathToFileURL } from "node:url";
import { createProxyServer, validateProxyOptions, } from "./features/proxy/index.js";
const defaultIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
};
const USAGE = `Usage:
  dsh-auth-proxy --target <upstream-url> [--listen 127.0.0.1:8443]
                 [--strip-secure-cookie | --no-strip-secure-cookie]
                 [--mark-proxy] [--local-token-env <VAR>] [--unsafe-plain-target]

--target is required: it names the upstream origin and is never guessed
(https with TLS verification unless --unsafe-plain-target is set).`;
/** 环境变量名 → 值；未设置时报错（fail-closed，与 auth-gate 纪律一致）。 */
function resolveLocalToken(argv, env) {
    const at = argv.indexOf("--local-token-env");
    const name = at === -1 ? undefined : argv[at + 1];
    if (name === undefined || name.startsWith("--"))
        throw new Error("--local-token-env requires a variable name");
    const value = env[name];
    if (value === undefined || value === "")
        throw new Error(`--local-token-env ${name} is not set`);
    return value;
}
function flag(argv, name) {
    return argv.includes(name);
}
function valueOf(argv, name, fallback) {
    const at = argv.indexOf(name);
    if (at === -1)
        return fallback;
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--"))
        throw new Error(`${name} requires a value`);
    return value;
}
/** 取必填参数值；缺失即报错（代理没有可猜的上游）。 */
function required(argv, name) {
    const at = argv.indexOf(name);
    if (at === -1)
        throw new Error(`${name} is required`);
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--"))
        throw new Error(`${name} requires a value`);
    return value;
}
/** 解析参数并完成校验（含回环监听、target 协议）。 */
export function parseProxyArgs(argv, env) {
    return {
        options: {
            listen: valueOf(argv, "--listen", "127.0.0.1:8443"),
            target: required(argv, "--target"),
            stripSecureCookie: !flag(argv, "--no-strip-secure-cookie"),
            markProxy: flag(argv, "--mark-proxy"),
            localToken: flag(argv, "--local-token-env") ? (resolveLocalToken(argv, env) ?? "") : "",
            unsafePlainTarget: flag(argv, "--unsafe-plain-target"),
        },
    };
}
export function main(argv, io) {
    try {
        if (argv.includes("--help") || argv.includes("-h")) {
            io.out(USAGE);
            return 0;
        }
        const { options } = parseProxyArgs(argv, process.env);
        const { hostname, port } = validateProxyOptions(options);
        const proxy = createProxyServer(options, (line) => io.err(line));
        proxy.listen(port, hostname, () => {
            io.out(`dsh-auth-proxy: listening on http://${hostname}:${String(port)} -> ${options.target}`);
            io.out("dsh-auth-proxy: open the listen URL in your browser (auth-gate login applies)");
        });
        proxy.on("error", (error) => {
            io.err(`dsh-auth-proxy: ${error instanceof Error ? error.message : String(error)}`);
            process.exitCode = 1;
        });
        return 0;
    }
    catch (error) {
        io.err(error instanceof Error ? error.message : String(error));
        io.err(USAGE);
        return 1;
    }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    process.exitCode = main(process.argv.slice(2), defaultIo);
}
//# sourceMappingURL=proxy-cli.js.map