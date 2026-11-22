import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import { delay, isCode } from "./atomic-write.js";
import { UsersFileError, errorMessage } from "./users-file-error.js";
/**
 * `users.yaml.lock` 的获取与释放（契约 §3.2-1）。
 *
 * 锁是独立文件的 `wx` 独占创建：持有者写 `{pid,host,token,startedAt}`；判陈旧时
 * **compare-then-rm** 复核两份观测（stat 指纹 + payload token）一致才删除，
 * 避免把另一个进程刚接手的活锁删掉。
 */
/** 锁冲突退避间隔（毫秒）。 */
const LOCK_RETRY_MS = 25;
/**
 * 取锁：`wx` 独占创建，EEXIST 时判陈旧（payload 不可读 / mtime 超 staleMs / 持有 pid 已死）
 * 则夺锁重试，否则退避至 timeoutMs。返回本次持有者的 token，供释放时 compare-and-unlink。
 */
export async function acquireLock(lockPath, timeoutMs, staleMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const token = await createLock(lockPath);
        if (token !== undefined)
            return token;
        if (await stealStaleLock(lockPath, staleMs))
            continue;
        if (Date.now() >= deadline) {
            throw new UsersFileError("users file is locked by another process");
        }
        await delay(LOCK_RETRY_MS);
    }
}
/** 释放锁（compare-and-unlink）：只删自己 token 的那把，绝不删新持有者的锁（§10 A8'）。 */
export async function releaseLock(lockPath, token) {
    const lock = await readLock(lockPath);
    if (lock?.token === token)
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
}
/** `wx` 独占创建并写入持有者信息（token = 随机 16 字节 hex）；EEXIST → undefined（别人持锁）。 */
async function createLock(lockPath) {
    const token = randomBytes(16).toString("hex");
    const owner = { pid: process.pid, host: os.hostname(), token, startedAt: Date.now() };
    try {
        await fs.writeFile(lockPath, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
        return token;
    }
    catch (error) {
        if (isCode(error, "EEXIST"))
            return undefined;
        throw new UsersFileError(`cannot lock users file: ${errorMessage(error)}`);
    }
}
/** 读锁文件；不存在 / 0 字节 / 损坏 → undefined（夺取侧按 stale 处理，释放侧不删，契约 §10 A8'）。 */
async function readLock(lockPath) {
    try {
        const parsed = JSON.parse(await fs.readFile(lockPath, "utf8"));
        const { pid, token } = (parsed ?? {});
        if (typeof pid !== "number" || typeof token !== "string" || token === "")
            return undefined;
        return { pid, token };
    }
    catch {
        return undefined;
    }
}
/** 观测一次锁文件：先 stat 再读 payload；两次观测之间的替换由 compare-then-rm 兜底。 */
async function observeLock(lockPath) {
    const stat = await fs.stat(lockPath).catch(() => undefined);
    const lock = stat === undefined ? undefined : await readLock(lockPath);
    const stamp = stat === undefined ? undefined : { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
    return { stamp, lock };
}
/** 是否可夺：payload 不可读（0 字节/损坏）、mtime 超期、或持有 pid 已死。 */
function lockIsStale(observed, staleMs) {
    const { stamp, lock } = observed;
    const fresh = stamp !== undefined && Date.now() - stamp.mtimeMs <= staleMs;
    return lock === undefined || !fresh || isPidDead(lock.pid);
}
/** 两次观测是否指向同一把锁：stat 指纹与 payload 都相同才算（inode 在 Windows 上也稳定）。 */
function sameLockObservation(left, right) {
    if (left.stamp === undefined || right.stamp === undefined)
        return left.stamp === right.stamp;
    return (left.stamp.ino === right.stamp.ino &&
        left.stamp.size === right.stamp.size &&
        left.stamp.mtimeMs === right.stamp.mtimeMs &&
        left.lock?.pid === right.lock?.pid &&
        left.lock?.token === right.lock?.token);
}
/**
 * 夺陈旧锁：先观测并判 stale，再观测一次确认仍是同一把锁（token/inode/mtime 未变）才删除。
 * 判定与删除之间被别的进程删掉或接手 → 不碰，交回外层重试：否则可能删掉刚被接手的活锁。
 */
async function stealStaleLock(lockPath, staleMs) {
    const observed = await observeLock(lockPath);
    if (!lockIsStale(observed, staleMs))
        return false;
    if (!sameLockObservation(observed, await observeLock(lockPath)))
        return false;
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
    return true;
}
/** `process.kill(pid, 0)` 抛 ESRCH 即进程已死；EPERM（他人进程）视为活着。 */
function isPidDead(pid) {
    try {
        process.kill(pid, 0);
        return false;
    }
    catch (error) {
        return isCode(error, "ESRCH");
    }
}
