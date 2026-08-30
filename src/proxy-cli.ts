#!/usr/bin/env node
/**
 * dsh-auth-proxy CLI：认证本地代理入口。
 *
 * 用法示例：
 *   dsh-auth-proxy --listen 127.0.0.1:8443 --target https://dsh.hi-ruofei.com
 */
import { pathToFileURL } from "node:url";
import {
  createProxyServer,
  validateProxyOptions,
  type ProxyOptions,
} from "./features/proxy/index.js";

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const defaultIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const USAGE = `Usage:
  dsh-auth-proxy [--listen 127.0.0.1:8443] [--target https://dsh.hi-ruofei.com]
                 [--strip-secure-cookie | --no-strip-secure-cookie]
                 [--mark-proxy] [--local-token-env <VAR>] [--unsafe-plain-target]`;

/** 环境变量名 → 值；未设置时报错（fail-closed，与 auth-gate 纪律一致）。 */
function resolveLocalToken(
  argv: string[],
  env: Record<string, string | undefined>,
): string | undefined {
  const at = argv.indexOf("--local-token-env");
  const name = at === -1 ? undefined : argv[at + 1];
  if (name === undefined || name.startsWith("--"))
    throw new Error("--local-token-env requires a variable name");
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`--local-token-env ${name} is not set`);
  return value;
}

function flag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function valueOf(argv: string[], name: string, fallback: string): string {
  const at = argv.indexOf(name);
  if (at === -1) return fallback;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

/** 解析参数并完成校验（含回环监听、target 协议）。 */
export function parseProxyArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): { options: ProxyOptions } {
  return {
    options: {
      listen: valueOf(argv, "--listen", "127.0.0.1:8443"),
      target: valueOf(argv, "--target", "https://dsh.hi-ruofei.com"),
      stripSecureCookie: !flag(argv, "--no-strip-secure-cookie"),
      markProxy: flag(argv, "--mark-proxy"),
      localToken: flag(argv, "--local-token-env") ? (resolveLocalToken(argv, env) ?? "") : "",
      unsafePlainTarget: flag(argv, "--unsafe-plain-target"),
    },
  };
}

export function main(argv: string[], io: CliIo): number {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      io.out(USAGE);
      return 0;
    }
    const { options } = parseProxyArgs(argv, process.env);
    const { hostname, port } = validateProxyOptions(options);
    const proxy = createProxyServer(options, (line) => io.err(line));
    proxy.listen(port, hostname, () => {
      io.out(
        `dsh-auth-proxy: listening on http://${hostname}:${String(port)} -> ${options.target}`,
      );
      io.out("dsh-auth-proxy: open the listen URL in your browser (auth-gate login applies)");
    });
    proxy.on("error", (error) => {
      io.err(`dsh-auth-proxy: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(USAGE);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2), defaultIo);
}
