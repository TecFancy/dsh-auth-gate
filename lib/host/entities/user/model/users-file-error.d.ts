/**
 * `users.yaml` 仓库的错误类型与消息提取。独立成文件：锁实现（`users-file-lock.ts`）
 * 与仓库主体（`users-file.ts`）都要用它，而两者互相引用会形成环。
 */
/** users 文件不可用（语法/schema/权限/锁/CAS）。message 面向操作员，可落日志。 */
export declare class UsersFileError extends Error {
}
/** 任意抛出值 → 面向操作员的 message（非 Error 一律 `String(value)`）。 */
export declare function errorMessage(error: unknown): string;
