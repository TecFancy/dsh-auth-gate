export interface PasskeyCliIo {
    out(line: string): void;
    err(line: string): void;
}
/** `passkey rm` 的 flag：`--id <prefix>` 与 `--all` 二选一（调用方已从 argv 摘出）。 */
export interface PasskeyFlags {
    id?: string;
    all?: boolean;
    /** 允许删掉最后一把（`passkey: "required"` 下会锁死账号，必须显式确认）。 */
    force?: boolean;
}
/**
 * `dsh-auth passkey <list|rm>`：运维面查看/删除某用户的通行密钥。
 *
 * list 只读；rm 在 `mutateUsersFile` 锁内重读并做前缀唯一匹配（并发注册也不会漏判歧义）。
 *
 * **删掉最后一把默认拒绝**，要 `--force` 才放行。CLI 读不到插件配置（`passkey` 在
 * Cordis 配置里，不在 users.yaml），所以无法判断实例是不是 passkey-only；一律要求显式确认
 * 比「口令可用时也拦」更安全 - 口令可用时删光凭据本来就没有正当理由，而 passkey-only 下
 * 删光等于锁死账号。HTTP 端点那边能读到配置，因此只在 `required` 时拒绝。
 */
export declare function handlePasskeyCli(file: string, sub: string | undefined, name: string | undefined, flags: PasskeyFlags, io: PasskeyCliIo): Promise<number>;
