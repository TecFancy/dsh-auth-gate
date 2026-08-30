#!/usr/bin/env node
import { type ProxyOptions } from "./features/proxy/index.js";
export interface CliIo {
    out(line: string): void;
    err(line: string): void;
}
/** 解析参数并完成校验（含回环监听、target 协议）。 */
export declare function parseProxyArgs(argv: string[], env: Record<string, string | undefined>): {
    options: ProxyOptions;
};
export declare function main(argv: string[], io: CliIo): number;
//# sourceMappingURL=proxy-cli.d.ts.map