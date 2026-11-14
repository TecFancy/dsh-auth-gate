export interface PasskeyCliIo {
    out(line: string): void;
    err(line: string): void;
}
/** `passkey rm` 的 flag：`--id <prefix>` 与 `--all` 二选一（调用方已从 argv 摘出）。 */
export interface PasskeyFlags {
    id?: string;
    all?: boolean;
}
/**
 * `dsh-auth passkey <list|rm>`：运维面查看/删除某用户的通行密钥。
 *
 * list 只读；rm 在 `mutateUsersFile` 锁内重读并做前缀唯一匹配（并发注册也不会漏判歧义），
 * 删掉最后一把只输出 warning、不阻断：口令始终是最后恢复通道。
 */
export declare function handlePasskeyCli(file: string, sub: string | undefined, name: string | undefined, flags: PasskeyFlags, io: PasskeyCliIo): Promise<number>;
//# sourceMappingURL=cli.d.ts.map