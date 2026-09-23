/** 用户名约束（P5）：字母/数字开头，可含 `._-`，总长 ≤ 64。匹配大小写敏感。 */
export declare const USERNAME_RE: RegExp;
/** 用户角色（契约 §3.1）：`admin` 是唯一提权档位；YAML 缺省 `user`。 */
export type UserRole = "user" | "admin";
export interface UserRecord {
    passwordHash: string;
    /** M3 只解析不使用（M4 TOTP）。 */
    totpSecret?: string;
    disabled: boolean;
    /** P1 新增；**可选**（loader 读时补 `user`）；写盘时 `user` 不落盘。 */
    role?: UserRole;
    /** P1 新增；**可选**（loader 读时补 `false`）；YAML 键 `must_change_password`，`false` 不落盘。 */
    mustChangePassword?: boolean;
}
export interface UsersSnapshot {
    users: Map<string, UserRecord>;
}
/** 加载结果：`missing` 区分"文件不存在"与"存在但无用户"（warn-once，P7）。 */
export interface UsersLoadResult {
    snapshot: UsersSnapshot;
    missing: boolean;
}
/** users 文件不可用（语法/schema/权限/锁/CAS）。message 面向操作员，可落日志。 */
export declare class UsersFileError extends Error {
}
/** P6：DSH_HOME env → `~/.dsh` 兜底。CLI 与插件共享。 */
export declare function dshHomeDir(): string;
/** P6：DSH_HOME env → `~/.dsh` 兜底，拼 `auth/users.yaml`。CLI 与插件共享。 */
export declare function defaultUsersFilePath(): string;
/** 每次登录现读（P7）。ENOENT → `{ snapshot: 空, missing: true }`（不抛）。 */
export declare function loadUsersFile(filePath: string): Promise<UsersLoadResult>;
/** 用户名字典序（显式比较器（eslint 要求；locale 无关））。 */
export declare function compareNames(a: string, b: string): number;
/** CLI 用（P19）：全量序列化 + 同目录 `.tmp` + 原子替换 + 0600；目录自动创建。 */
export declare function writeUsersFile(filePath: string, snapshot: UsersSnapshot): Promise<void>;
/**
 * 锁内 read-modify-write（契约 §3.2）：CLI 与端点的唯一变更入口。
 * mutator 内抛错 → 原样上抛（UsersFileError 保持类型）；锁内任何失败都释放锁。
 * **mutator 内不得再次调用 mutateUsersFile**（同一 lock 文件 → 自死锁，契约 §10 A8）；
 * 需要多步变更时在同一个 mutator 里改完再返回。
 */
export declare function mutateUsersFile<T>(filePath: string, mutator: (snapshot: UsersSnapshot) => T | Promise<T>, options?: {
    timeoutMs?: number;
    staleMs?: number;
    attempts?: number;
}): Promise<T>;
type RenameFn = (from: string, to: string) => Promise<void>;
/**
 * 原子替换的同目录 `rename`：短暂占用退避重试，其余错误立即上抛。
 * 重试耗尽后抛最后一次错误，调用方看到的失败语义不变。
 */
export declare function renameWithRetry(from: string, to: string, rename?: RenameFn): Promise<void>;
export {};
//# sourceMappingURL=users-file.d.ts.map