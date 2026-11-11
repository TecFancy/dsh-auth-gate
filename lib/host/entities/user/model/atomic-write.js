import { promises as fs } from "node:fs";
/** Windows 上短暂占用（防病毒/索引器持有句柄）导致的 rename 失败至多重试次数。 */
const RENAME_ATTEMPTS = 5;
/** 退避基数（毫秒）；第 n 次重试前等 `n * RENAME_BACKOFF_MS`。 */
const RENAME_BACKOFF_MS = 20;
/** 目标句柄被短暂占用的错误码（Windows 实测 EPERM，另两类一并容错）。 */
function isTransientRenameError(error) {
    return isCode(error, "EPERM") || isCode(error, "EBUSY") || isCode(error, "EACCES");
}
/** 固定毫秒延迟（锁退避与 rename 退避共用）。 */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Node fs 错误的 errno 判定（非 Error 或没有 `code` 一律 false）。 */
export function isCode(error, code) {
    return error instanceof Error && "code" in error && error.code === code;
}
/**
 * 原子替换的同目录 `rename`：短暂占用退避重试，其余错误立即上抛。
 * 重试耗尽后抛最后一次错误，调用方看到的失败语义不变。
 */
export async function renameWithRetry(from, to, rename = (source, target) => fs.rename(source, target)) {
    for (let attempt = 1;; attempt += 1) {
        try {
            await rename(from, to);
            return;
        }
        catch (error) {
            if (attempt >= RENAME_ATTEMPTS || !isTransientRenameError(error))
                throw error;
            await delay(RENAME_BACKOFF_MS * attempt);
        }
    }
}
//# sourceMappingURL=atomic-write.js.map