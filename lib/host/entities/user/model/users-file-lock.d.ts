/**
 * 取锁：`wx` 独占创建，EEXIST 时判陈旧（payload 不可读 / mtime 超 staleMs / 持有 pid 已死）
 * 则夺锁重试，否则退避至 timeoutMs。返回本次持有者的 token，供释放时 compare-and-unlink。
 */
export declare function acquireLock(lockPath: string, timeoutMs: number, staleMs: number): Promise<string>;
/** 释放锁（compare-and-unlink）：只删自己 token 的那把，绝不删新持有者的锁（§10 A8'）。 */
export declare function releaseLock(lockPath: string, token: string): Promise<void>;
