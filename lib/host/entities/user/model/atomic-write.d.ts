/**
 * 原子替换的写入原语：同目录唯一 `tmp` + `fsync` + `rename` + 目录 `fsync`，
 * 以及短暂占用退避与 fs errno 判定。
 *
 * 从 `users-file.ts` 抽出（该文件已在 ESLint 250 行上限附近）。`users-file.ts`
 * 继续以 `renameWithRetry` 的名字对外提供重试原语。
 */
type RenameFn = (from: string, to: string) => Promise<void>;
/** 原子写所需的 fs 句柄面（测试注入假实现，用来钉住 fsync/rename 的顺序）。 */
export interface AtomicFileHandle {
    writeFile(data: string): Promise<void>;
    /** fsync：rename 之前必须落盘，否则掉电后 rename 可能指向空文件。 */
    sync(): Promise<void>;
    close(): Promise<void>;
}
/** 原子写依赖的最小 fs 面；缺省实现就是 `node:fs/promises`。 */
export interface AtomicFileSystem {
    open(filePath: string, flags: string, mode?: number): Promise<AtomicFileHandle>;
    rename(from: string, to: string): Promise<void>;
    rm(filePath: string, options?: {
        force?: boolean;
    }): Promise<void>;
}
/** 固定毫秒延迟（锁退避与 rename 退避共用）。 */
export declare function delay(ms: number): Promise<void>;
/** Node fs 错误的 errno 判定（非 Error 或没有 `code` 一律 false）。 */
export declare function isCode(error: unknown, code: string): boolean;
/**
 * 原子替换的同目录 `rename`：短暂占用退避重试，其余错误立即上抛。
 * 重试耗尽后抛最后一次错误，调用方看到的失败语义不变。
 */
export declare function renameWithRetry(from: string, to: string, rename?: RenameFn): Promise<void>;
/**
 * 同目录唯一临时名：pid + 8 字节随机后缀。固定 `<file>.tmp` 会让两个写者
 * 互相覆盖对方的半成品，随机后缀后的 rename 各写各的、后到者整体胜出。
 */
export declare function tmpPathFor(filePath: string): string;
/**
 * 原子且持久化的整文件替换：`fsync(tmp)` → `rename` → `fsync(目录)`。
 *
 * 三处失败语义：
 * - 写或 fsync 失败：删除本写者自己的 tmp 后上抛，目标文件保持旧内容；
 * - rename 失败（重试耗尽）：同样删除 tmp 后上抛；
 * - 目录 fsync 失败：忽略（Windows 与部分文件系统不支持打开目录同步，
 *   而文件内容已 fsync、rename 已生效，丢的只是目录项落盘保证）。
 *
 * `mode` 只在本写者创建 tmp 时生效（tmp 恒为新文件），默认 0600。
 */
export declare function writeFileAtomic(filePath: string, text: string, options?: {
    mode?: number;
    fs?: AtomicFileSystem;
}): Promise<void>;
export {};
