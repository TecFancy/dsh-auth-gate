#!/usr/bin/env node
export interface CliIo {
    out(line: string): void;
    err(line: string): void;
    /** 一次会话读 n 行（去尾部 `\r\n`）；不足 n 行 → 返回实际行数（EOF 即止）。 */
    readLines(count: number): Promise<string[]>;
    /** TTY 隐藏回显读一行口令；缺省实现读真实 stdin（仅 process.stdin.isTTY 为真时使用）。 */
    readSecret?: (prompt: string) => Promise<string>;
}
/** 返回进程退出码。所有参数/IO 经 argv/io 注入（可测，禁 console.*）。 */
export declare function main(argv: string[], io: CliIo): Promise<number>;
//# sourceMappingURL=cli.d.ts.map