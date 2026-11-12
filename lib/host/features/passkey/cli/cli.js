import { loadUsersFile, mutateUsersFile, UsersFileError, } from "../../../entities/user/index.js";
/** `list` 展示的 credentialId 前缀长度；完整凭据 ID 不上终端。 */
const CREDENTIAL_ID_DISPLAY_LENGTH = 12;
/** `rm --id` 允许的最短前缀长度（≥ 8 字符，避免误删）。 */
const MIN_ID_PREFIX_LENGTH = 8;
/**
 * `dsh-auth passkey <list|rm>`：运维面查看/删除某用户的通行密钥。
 *
 * list 只读；rm 在 `mutateUsersFile` 锁内重读并做前缀唯一匹配（并发注册也不会漏判歧义），
 * 删掉最后一把只输出 warning、不阻断：口令始终是最后恢复通道。
 */
export async function handlePasskeyCli(file, sub, name, flags, io) {
    if (sub === "list")
        return listPasskeys(file, name, io);
    if (sub === "rm")
        return removePasskeys(file, name, flags, io);
    return usage(io);
}
/** `passkey list <name>`：用户不存在（含文件缺失）→ 报错返回 1；无凭据不是错误。 */
async function listPasskeys(file, name, io) {
    if (name === undefined)
        return usage(io);
    const snapshot = await readSnapshot(file, io);
    if (snapshot === undefined)
        return 1;
    const user = snapshot.users.get(name);
    if (user === undefined) {
        io.err(`user ${name} not found`);
        return 1;
    }
    const passkeys = user.passkeys ?? [];
    if (passkeys.length === 0) {
        io.out(`no passkeys for ${name}`);
        return 0;
    }
    for (const passkey of passkeys)
        io.out(formatPasskey(passkey));
    return 0;
}
/** `passkey rm`：`--id <prefix>` 与 `--all` 必须恰好给一个，否则 usage。 */
async function removePasskeys(file, name, flags, io) {
    if (name === undefined)
        return usage(io);
    const prefix = flags.id?.trim();
    const all = flags.all === true;
    if (all && prefix !== undefined)
        return usage(io);
    if (all)
        return removeAll(file, name, io);
    if (prefix === undefined)
        return usage(io);
    return removeByPrefix(file, name, prefix, io);
}
/** 前缀唯一匹配后删除一把；前缀过短/无匹配/歧义都在锁内报错，不落盘。 */
async function removeByPrefix(file, name, prefix, io) {
    if (prefix.length < MIN_ID_PREFIX_LENGTH) {
        io.err(`--id must be at least ${MIN_ID_PREFIX_LENGTH} characters`);
        return 1;
    }
    const removed = await mutate(file, io, (snapshot) => {
        const user = snapshot.users.get(name);
        if (user === undefined)
            throw new UsersFileError(`user ${name} not found`);
        const passkeys = user.passkeys ?? [];
        const matches = passkeys.filter((passkey) => passkey.credentialId.startsWith(prefix));
        const target = matches.at(0);
        if (target === undefined)
            throw new UsersFileError(`no passkey matches ${prefix}`);
        if (matches.length > 1) {
            throw new UsersFileError(`passkey id prefix is ambiguous (${matches.length} matches)`);
        }
        snapshot.users.set(name, {
            ...user,
            passkeys: passkeys.filter((passkey) => passkey !== target),
        });
        return { label: target.label, remaining: passkeys.length - 1 };
    });
    if (removed === undefined)
        return 1;
    io.out(`removed passkey ${removed.label} from ${name}`);
    if (removed.remaining === 0)
        io.out(`warning: ${name} has no passkeys left`);
    return 0;
}
/** 删光该用户全部凭据（0 把也无害，输出统一措辞）。 */
async function removeAll(file, name, io) {
    const removed = await mutate(file, io, (snapshot) => {
        const user = snapshot.users.get(name);
        if (user === undefined)
            throw new UsersFileError(`user ${name} not found`);
        const passkeys = user.passkeys ?? [];
        snapshot.users.set(name, { ...user, passkeys: [] });
        return passkeys.length;
    });
    if (removed === undefined)
        return 1;
    io.out(`removed ${removed} passkeys from ${name}`);
    return 0;
}
/** list 的单行输出：固定字段序、英文；完整 credentialId 与公钥都不出现。 */
function formatPasskey(record) {
    const id = record.credentialId.slice(0, CREDENTIAL_ID_DISPLAY_LENGTH);
    const lastUsed = record.lastUsedAt === 0 ? "never" : new Date(record.lastUsedAt).toISOString();
    const transports = record.transports.length === 0 ? "-" : record.transports.join(",");
    const created = new Date(record.createdAt).toISOString();
    return (`${record.label} · id=${id}… · created=${created} · last-used=${lastUsed}` +
        ` · be=${record.be} bs=${record.bs} · transports=${transports}`);
}
/** 统一 usage 出口（参数错误都走这里）。 */
function usage(io) {
    io.err("Usage: dsh-auth passkey <list|rm> ...");
    return 1;
}
/** 锁外只读预读；读失败 → 报错返回 undefined。 */
async function readSnapshot(file, io) {
    try {
        return (await loadUsersFile(file)).snapshot;
    }
    catch (error) {
        io.err(errorMessage(error));
        return undefined;
    }
}
/** 锁内变更 + 统一错误出口；mutator 抛错 → 报错返回 undefined（不落盘）。 */
async function mutate(file, io, run) {
    try {
        return await mutateUsersFile(file, run);
    }
    catch (error) {
        io.err(errorMessage(error));
        return undefined;
    }
}
function errorMessage(error) {
    if (error instanceof UsersFileError)
        return error.message;
    if (error instanceof Error)
        return error.message;
    return String(error);
}
//# sourceMappingURL=cli.js.map