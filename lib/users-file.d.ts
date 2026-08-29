/** 用户名约束（P5）：字母/数字开头，可含 `._-`，总长 ≤ 64。匹配大小写敏感。 */
export declare const USERNAME_RE: RegExp;
export interface UserRecord {
    passwordHash: string;
    /** M3 只解析不使用（M4 TOTP）。 */
    totpSecret?: string;
    disabled: boolean;
}
export interface UsersSnapshot {
    users: Map<string, UserRecord>;
}
/** 加载结果：`missing` 区分"文件不存在"与"存在但无用户"（warn-once，P7）。 */
export interface UsersLoadResult {
    snapshot: UsersSnapshot;
    missing: boolean;
}
/** users 文件不可用（语法/schema/权限）。message 面向操作员，可落日志。 */
export declare class UsersFileError extends Error {
}
/** P6：DSH_HOME env → `~/.dsh` 兜底。CLI 与插件共享。 */
export declare function dshHomeDir(): string;
/** P6：DSH_HOME env → `~/.dsh` 兜底，拼 `auth/users.yaml`。CLI 与插件共享。 */
export declare function defaultUsersFilePath(): string;
/** 每次登录现读（P7）。ENOENT → `{ snapshot: 空, missing: true }`（不抛）。 */
export declare function loadUsersFile(filePath: string): Promise<UsersLoadResult>;
/** 用户名字典序（显式比较器——eslint 要求；locale 无关）。 */
export declare function compareNames(a: string, b: string): number;
/** CLI 用（P19）：全量序列化 + 同目录 `.tmp` + 原子替换 + 0600；目录自动创建。 */
export declare function writeUsersFile(filePath: string, snapshot: UsersSnapshot): Promise<void>;
//# sourceMappingURL=users-file.d.ts.map