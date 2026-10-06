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
/**
 * 当前进程是否在直接运行这个入口文件。
 *
 * 全局安装的 bin 是符号链接：`process.argv[1]` 是链接，`import.meta.url` 是真实文件。
 * 比较前必须解析真实路径，否则会跳过 `main()`，进程不输出就退出。
 *
 * `argvPath` 缺失，或者解析不到真实文件时返回 false：两种情况下它都不可能是本入口，
 * 而 import 本模块的进程不该因此崩溃（`node -e`、测试运行器的 argv[1] 都不是本文件）。
 */
export declare function isInvokedEntry(entryUrl: string, argvPath: string | undefined): boolean;
export declare function main(argv: string[], io: CliIo): number;
//# sourceMappingURL=proxy-cli.d.ts.map