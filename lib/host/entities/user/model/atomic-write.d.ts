/**
 * 原子替换的写入原语：同目录 `rename` + 短暂占用退避 + fs errno 判定。
 *
 * 从 `users-file.ts` 抽出（该文件已在 ESLint 250 行上限附近），行为与导出名不变：
 * `users-file.ts` 继续以 `renameWithRetry` 的名字对外提供。
 */
type RenameFn = (from: string, to: string) => Promise<void>;
/** 固定毫秒延迟（锁退避与 rename 退避共用）。 */
export declare function delay(ms: number): Promise<void>;
/** Node fs 错误的 errno 判定（非 Error 或没有 `code` 一律 false）。 */
export declare function isCode(error: unknown, code: string): boolean;
/**
 * 原子替换的同目录 `rename`：短暂占用退避重试，其余错误立即上抛。
 * 重试耗尽后抛最后一次错误，调用方看到的失败语义不变。
 */
export declare function renameWithRetry(from: string, to: string, rename?: RenameFn): Promise<void>;
export {};
//# sourceMappingURL=atomic-write.d.ts.map