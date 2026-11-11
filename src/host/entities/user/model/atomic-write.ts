import { promises as fs } from "node:fs";

/**
 * 原子替换的写入原语：同目录 `rename` + 短暂占用退避 + fs errno 判定。
 *
 * 从 `users-file.ts` 抽出（该文件已在 ESLint 250 行上限附近），行为与导出名不变：
 * `users-file.ts` 继续以 `renameWithRetry` 的名字对外提供。
 */

type RenameFn = (from: string, to: string) => Promise<void>;

/** Windows 上短暂占用（防病毒/索引器持有句柄）导致的 rename 失败至多重试次数。 */
const RENAME_ATTEMPTS = 5;

/** 退避基数（毫秒）；第 n 次重试前等 `n * RENAME_BACKOFF_MS`。 */
const RENAME_BACKOFF_MS = 20;

/** 目标句柄被短暂占用的错误码（Windows 实测 EPERM，另两类一并容错）。 */
function isTransientRenameError(error: unknown): boolean {
  return isCode(error, "EPERM") || isCode(error, "EBUSY") || isCode(error, "EACCES");
}

/** 固定毫秒延迟（锁退避与 rename 退避共用）。 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Node fs 错误的 errno 判定（非 Error 或没有 `code` 一律 false）。 */
export function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * 原子替换的同目录 `rename`：短暂占用退避重试，其余错误立即上抛。
 * 重试耗尽后抛最后一次错误，调用方看到的失败语义不变。
 */
export async function renameWithRetry(
  from: string,
  to: string,
  rename: RenameFn = (source, target) => fs.rename(source, target),
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isTransientRenameError(error)) throw error;
      await delay(RENAME_BACKOFF_MS * attempt);
    }
  }
}
