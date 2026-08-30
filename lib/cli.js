#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { hashPassword } from "./features/password/index.js";
import { handleUserTotp } from "./features/totp/index.js";
import { bundledSkillDir, installSkill, userSkillDir, SKILL_NAME } from "./shared/index.js";
import { compareNames, defaultUsersFilePath, loadUsersFile, USERNAME_RE, UsersFileError, writeUsersFile, } from "./shared/index.js";
const USAGE = `Usage:
  dsh-auth user add <name> --password-stdin [--disabled] [--file <path>]
  dsh-auth user list [--file <path>]
  dsh-auth user disable <name> [--file <path>]
  dsh-auth user totp <enable|disable> <name> [--file <path>]
  dsh-auth skill install [--force]`;
const defaultIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    readLine: async () => {
        // asyncIterator 顺序保证：once 监听器在"数据先于 createInterface 到达并 EOF"时
        // close 可能先于 line（实测管道输入偶发返回空串（M3 服务器冒烟踩坑））。
        const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
        for await (const line of lines)
            return line;
        return "";
    },
};
/** 返回进程退出码。所有参数/IO 经 argv/io 注入（可测，禁 console.*）。 */
export async function main(argv, io) {
    const file = pickFile(argv);
    if (file === undefined) {
        io.err(USAGE);
        return 1;
    }
    const tokens = argv.filter((token) => token !== "--file");
    const sub = tokens[0];
    if (sub === "skill") {
        const command = tokens[1];
        if (command === "install")
            return installSkillCommand(io, argv.includes("--force"));
        io.err(USAGE);
        return 1;
    }
    if (sub !== "user") {
        io.err(USAGE);
        return 1;
    }
    const command = tokens[1];
    if (command === "add")
        return addUser(file, tokens[2], argv.includes("--password-stdin"), argv.includes("--disabled"), io);
    if (command === "list")
        return listUsers(file, io);
    if (command === "disable")
        return disableUser(file, tokens[2], io);
    if (command === "totp")
        return handleUserTotp(file, tokens[2], tokens[3], io);
    io.err(USAGE);
    return 1;
}
/** 扫描 `--file <path>`；缺失 → 默认路径；`--file` 后无值 → undefined（usage 错误）。 */
function pickFile(argv) {
    const at = argv.indexOf("--file");
    if (at === -1)
        return defaultUsersFilePath();
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--"))
        return undefined;
    return value;
}
async function addUser(file, name, hasStdin, disabled, io) {
    if (name === undefined || !USERNAME_RE.test(name)) {
        io.err(USAGE);
        return 1;
    }
    if (!hasStdin) {
        io.err(USAGE);
        return 1;
    }
    const snapshot = await loadSnapshot(file, io);
    if (snapshot === undefined)
        return 1;
    if (snapshot.users.has(name)) {
        io.err(`user ${name} already exists`);
        return 1;
    }
    const password = await io.readLine();
    if (password === "") {
        io.err("empty password");
        return 1;
    }
    try {
        snapshot.users.set(name, { passwordHash: await hashPassword(password), disabled });
        await writeUsersFile(file, snapshot);
    }
    catch (error) {
        io.err(errorMessage(error));
        return 1;
    }
    io.out(`user ${name} added`);
    return 0;
}
async function listUsers(file, io) {
    const snapshot = await loadSnapshot(file, io);
    if (snapshot === undefined)
        return 1;
    const names = [...snapshot.users.keys()].sort(compareNames);
    for (const name of names) {
        const user = snapshot.users.get(name);
        io.out(user?.disabled === true ? `${name} (disabled)` : name);
    }
    return 0;
}
/** `dsh-auth skill install [--force]`：把包内配置速查技能装到 $DSH_HOME/skills/。 */
async function installSkillCommand(io, force) {
    const target = userSkillDir();
    const result = await installSkill({ sourceDir: bundledSkillDir(), targetDir: target, force });
    if (result.status === "source-missing") {
        io.err("bundled skill not found (package layout changed?)");
        return 1;
    }
    if (result.status === "up-to-date") {
        io.out(`skill ${SKILL_NAME} already installed at ${target} (use --force to update)`);
        return 0;
    }
    io.out(`skill ${SKILL_NAME} installed to ${target}`);
    return 0;
}
async function disableUser(file, name, io) {
    if (name === undefined) {
        io.err(USAGE);
        return 1;
    }
    const snapshot = await loadSnapshot(file, io);
    if (snapshot === undefined)
        return 1;
    const user = snapshot.users.get(name);
    if (user === undefined) {
        io.err(`user not found`);
        return 1;
    }
    try {
        snapshot.users.set(name, { ...user, disabled: true });
        await writeUsersFile(file, snapshot);
    }
    catch (error) {
        io.err(errorMessage(error));
        return 1;
    }
    io.out(`user ${name} disabled`);
    return 0;
}
async function loadSnapshot(file, io) {
    try {
        return (await loadUsersFile(file)).snapshot;
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
// 入口判定必须走真实路径：pnpm/git 安装的 node_modules 是符号链接，argv[1]
// 是软链路径而 import.meta.url 已解析到真实文件，直接比较会静默跳过 main()。
const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (import.meta.url === pathToFileURL(entryPath).href) {
    void main(process.argv.slice(2), defaultIo).then((code) => {
        process.exitCode = code;
    });
}
//# sourceMappingURL=cli.js.map