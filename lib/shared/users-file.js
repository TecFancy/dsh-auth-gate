import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";
/** 用户名约束（P5）：字母/数字开头，可含 `._-`，总长 ≤ 64。匹配大小写敏感。 */
export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
/** users 文件不可用（语法/schema/权限/锁/CAS）。message 面向操作员，可落日志。 */
export class UsersFileError extends Error {
}
const userRecordSchema = z
    .object({
    passwordHash: z.string().min(1),
    totpSecret: z.string().optional(),
    disabled: z.boolean().optional(),
    role: z.enum(["user", "admin"]).optional(),
    must_change_password: z.boolean().optional(),
})
    .strict();
const usersFileSchema = z
    .object({
    version: z.literal(1),
    users: z.record(z.string(), userRecordSchema),
})
    .strict();
/** P6：DSH_HOME env → `~/.dsh` 兜底。CLI 与插件共享。 */
export function dshHomeDir() {
    return process.env["DSH_HOME"] ?? path.join(os.homedir(), ".dsh");
}
/** P6：DSH_HOME env → `~/.dsh` 兜底，拼 `auth/users.yaml`。CLI 与插件共享。 */
export function defaultUsersFilePath() {
    return path.join(dshHomeDir(), "auth", "users.yaml");
}
/** 每次登录现读（P7）。ENOENT → `{ snapshot: 空, missing: true }`（不抛）。 */
export async function loadUsersFile(filePath) {
    let stat;
    try {
        stat = await fs.stat(filePath);
    }
    catch (error) {
        if (isEnoent(error))
            return { snapshot: { users: new Map() }, missing: true };
        throw new UsersFileError(`cannot stat users file: ${errorMessage(error)}`);
    }
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
        throw new UsersFileError(`users file has insecure permissions: ${filePath}`);
    }
    let text;
    try {
        text = await fs.readFile(filePath, "utf8");
    }
    catch (error) {
        throw new UsersFileError(`cannot read users file: ${errorMessage(error)}`);
    }
    let parsed;
    try {
        parsed = parseYaml(text);
    }
    catch (error) {
        throw new UsersFileError(`invalid users file: ${errorMessage(error)}`);
    }
    const result = usersFileSchema.safeParse(parsed);
    if (!result.success) {
        throw new UsersFileError(`invalid users file: ${result.error.message}`);
    }
    const users = new Map();
    for (const [name, record] of Object.entries(result.data.users)) {
        if (!USERNAME_RE.test(name)) {
            throw new UsersFileError(`invalid users file: invalid username: ${name}`);
        }
        users.set(name, {
            passwordHash: record.passwordHash,
            ...(record.totpSecret === undefined ? {} : { totpSecret: record.totpSecret }),
            disabled: record.disabled ?? false,
            role: record.role ?? "user",
            mustChangePassword: record.must_change_password ?? false,
        });
    }
    return { snapshot: { users }, missing: false };
}
/** 用户名字典序（显式比较器（eslint 要求；locale 无关））。 */
export function compareNames(a, b) {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}
/** CLI 用（P19）：全量序列化 + 同目录 `.tmp` + 原子替换 + 0600；目录自动创建。 */
export async function writeUsersFile(filePath, snapshot) {
    const users = {};
    const names = [...snapshot.users.keys()].sort(compareNames);
    for (const name of names) {
        const record = snapshot.users.get(name);
        if (record === undefined)
            continue;
        users[name] = {
            passwordHash: record.passwordHash,
            ...(record.totpSecret === undefined ? {} : { totpSecret: record.totpSecret }),
            ...(record.disabled ? { disabled: true } : {}),
            ...(record.role === "admin" ? { role: "admin" } : {}),
            ...(record.mustChangePassword ? { must_change_password: true } : {}),
        };
    }
    const text = stringify({ version: 1, users });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(`${filePath}.tmp`, text, { mode: 0o600 });
    await renameWithRetry(`${filePath}.tmp`, filePath);
}
/** 锁冲突退避间隔（毫秒）。 */
const LOCK_RETRY_MS = 25;
/**
 * 锁内 read-modify-write（契约 §3.2）：CLI 与端点的唯一变更入口。
 * mutator 内抛错 → 原样上抛（UsersFileError 保持类型）；锁内任何失败都释放锁。
 * **mutator 内不得再次调用 mutateUsersFile**（同一 lock 文件 → 自死锁，契约 §10 A8）；
 * 需要多步变更时在同一个 mutator 里改完再返回。
 */
export async function mutateUsersFile(filePath, mutator, options) {
    const timeoutMs = options?.timeoutMs ?? 5_000; // 契约 §3.2-1
    const staleMs = options?.staleMs ?? 10_000; // 契约 §3.2-1
    const attempts = options?.attempts ?? 3; // 契约 §3.2-2
    const lockPath = `${filePath}.lock`;
    await fs.mkdir(path.dirname(filePath), { recursive: true }).catch((error) => {
        throw new UsersFileError(`cannot create users directory: ${errorMessage(error)}`);
    });
    const token = await acquireLock(lockPath, timeoutMs, staleMs);
    try {
        return await runMutation(filePath, mutator, attempts);
    }
    finally {
        // compare-and-unlink：本进程的锁若已被判 stale 并被新持有者接手，绝不删别人的锁（§10 A8'）。
        const lock = await readLock(lockPath);
        if (lock?.token === token)
            await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
}
/** 锁内的读 → mutator → 写前 CAS → 备份 → 原子写（契约 §3.2-2/3/4）。 */
async function runMutation(filePath, mutator, attempts) {
    for (let attempt = 1;; attempt += 1) {
        // 指纹先于读：读之后落地的外部写入会让下面的 CAS 复核失败。
        const before = await fileStamp(filePath);
        const snapshot = (await loadUsersFile(filePath)).snapshot;
        const adminsBefore = countActiveAdmins(snapshot);
        const result = await mutator(snapshot);
        const after = await fileStamp(filePath);
        if (before?.mtimeMs !== after?.mtimeMs || before?.size !== after?.size) {
            if (attempt >= attempts) {
                throw new UsersFileError("users file changed while it was locked; giving up");
            }
            continue;
        }
        if (adminsBefore > 0 && countActiveAdmins(snapshot) === 0) {
            throw new UsersFileError("cannot remove the last admin");
        }
        await backupUsersFile(filePath);
        await writeUsersFile(filePath, snapshot);
        return result;
    }
}
/**
 * 取锁（契约 §3.2-1）：`users.yaml.lock` 独立文件 `wx` 独占创建并写 `{pid,host,token,startedAt}`。
 * EEXIST → 陈旧（payload 不可读 / mtime 超 staleMs / 持有 pid 已死）则夺锁重试，否则退避至 timeoutMs。
 * 返回本次持有者的 token，供释放时 compare-and-unlink。
 */
async function acquireLock(lockPath, timeoutMs, staleMs) {
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
/** 锁是否可夺：payload 不可读（0 字节/损坏）、mtime 超期、或持有 pid 已死。 */
async function stealStaleLock(lockPath, staleMs) {
    const stat = await fs.stat(lockPath).catch(() => undefined);
    const lock = await readLock(lockPath);
    const fresh = stat !== undefined && Date.now() - stat.mtimeMs <= staleMs;
    if (lock !== undefined && fresh && !isPidDead(lock.pid))
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
/** 文件指纹（mtime + size）；不存在 → undefined（缺失是合法初态）。 */
async function fileStamp(filePath) {
    const stat = await fs.stat(filePath).catch((error) => {
        if (isEnoent(error))
            return undefined;
        throw new UsersFileError(`cannot stat users file: ${errorMessage(error)}`);
    });
    return stat === undefined ? undefined : { mtimeMs: stat.mtimeMs, size: stat.size };
}
/** 活跃 admin 数（last-admin 不变量：`role === "admin"` 且未 disabled）。 */
function countActiveAdmins(snapshot) {
    return [...snapshot.users.values()].filter((u) => u.role === "admin" && !u.disabled).length;
}
/** 写前滚动备份 `.bak`（0600）；失败不阻断主写（契约 §3.2-3）。 */
async function backupUsersFile(filePath) {
    await fs.copyFile(filePath, `${filePath}.bak`).catch(() => undefined);
    await fs.chmod(`${filePath}.bak`, 0o600).catch(() => undefined);
}
/** Windows 上短暂占用（防病毒/索引器持有句柄）导致的 rename 失败至多重试次数。 */
const RENAME_ATTEMPTS = 5;
/** 退避基数（毫秒）；第 n 次重试前等 `n * RENAME_BACKOFF_MS`。 */
const RENAME_BACKOFF_MS = 20;
/** 目标句柄被短暂占用的错误码（Windows 实测 EPERM，另两类一并容错）。 */
function isTransientRenameError(error) {
    return isCode(error, "EPERM") || isCode(error, "EBUSY") || isCode(error, "EACCES");
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
function isCode(error, code) {
    return error instanceof Error && "code" in error && error.code === code;
}
function isEnoent(error) {
    return isCode(error, "ENOENT");
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=users-file.js.map