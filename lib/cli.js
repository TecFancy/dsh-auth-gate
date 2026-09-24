#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { hashPassword, verifyPassword } from "./features/password/index.js";
import { handleUserTotp } from "./features/totp/index.js";
import { bundledSkillDir, checkPasswordPolicy, compareNames, defaultUsersFilePath, installSkill, loadUsersFile, mutateUsersFile, SKILL_NAME, USERNAME_RE, userSkillDir, UsersFileError, } from "./shared/index.js";
/** TOTP 用户改密告警（P1 §7；文案沿用现有英文 CLI 风格）。 */
const TOTP_WARNING = "warning: this user has TOTP; codes are unchanged, but sessions must re-login";
const USAGE = `Usage:
  dsh-auth user add <name> --password-stdin [--admin] [--disabled] [--file <path>]
  dsh-auth user passwd <name> [--password-stdin] [--file <path>]
  dsh-auth user role <name> <admin|user> [--file <path>]
  dsh-auth user list [--file <path>]
  dsh-auth user disable <name> [--file <path>]
  dsh-auth user totp <enable|disable> <name> [--file <path>]
  dsh-auth skill install [--force]`;
const defaultIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    readLines: async (count) => {
        // 必须一次会话读 n 行：每次新建 readline 都会在 close 时丢掉已缓冲的后续行，
        // `printf 'a\nb\n' | …` 第二次调用恒为 ""（M3 遗留写法，P1 评审 A3 实测）。
        const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
        const lines = [];
        for await (const line of rl) {
            lines.push(line);
            if (lines.length === count)
                break;
        }
        rl.close();
        return lines;
    },
};
/** TTY 隐藏回显读一行：静音 readline 的终端回显（仅 isTTY 分支可达）。 */
function readSecretFromTty(prompt) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- 回显静音，不是空实现
    rl._writeToOutput = () => { };
    process.stdout.write(prompt);
    return new Promise((resolve) => {
        rl.question("", (answer) => {
            rl.close();
            process.stdout.write("\n");
            resolve(answer);
        });
    });
}
/** 返回进程退出码。所有参数/IO 经 argv/io 注入（可测，禁 console.*）。 */
export async function main(argv, io) {
    const file = pickFile(argv);
    if (file === undefined)
        return usage(io);
    const ctx = { file, argv, io };
    const args = positionals(argv);
    if (args[0] === "skill")
        return args[1] === "install" ? installSkillCommand(ctx) : usage(io);
    if (args[0] !== "user")
        return usage(io);
    const handlers = {
        add: () => addUser(ctx, args[2]),
        passwd: () => passwdUser(ctx, args[2]),
        role: () => setRole(ctx, args[2], args[3]),
        list: () => listUsers(ctx),
        disable: () => disableUser(ctx, args[2]),
        totp: () => handleUserTotp(file, args[2], args[3], io),
    };
    const handler = handlers[args[1] ?? ""];
    return handler === undefined ? usage(io) : handler();
}
/** usage 错误出口：打印 USAGE 并返回退出码 1。 */
function usage(io) {
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
/** 位置参数：剥离 flag 与 `--file <path>` 的值（`--file` 无值由 pickFile 报 usage）。 */
function positionals(argv) {
    const args = [];
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index] ?? "";
        if (token === "--file")
            index += 1;
        else if (!token.startsWith("--"))
            args.push(token);
    }
    return args;
}
/** 明文 `--password` 一律拒绝（P1 §7：口令只走 stdin/交互输入）。 */
function isPasswordFlag(token) {
    return token === "--password" || token.startsWith("--password=");
}
/** 锁内变更 + 统一错误出口；mutator 抛错 → 报错并返回 false（不落盘）。 */
async function mutate(ctx, run) {
    try {
        await mutateUsersFile(ctx.file, run);
        return true;
    }
    catch (error) {
        ctx.io.err(errorMessage(error));
        return false;
    }
}
/** 锁内 RMW 单个用户；不存在 → 报错（绝不新建）。 */
async function edit(ctx, name, apply) {
    return mutate(ctx, (snapshot) => {
        const user = snapshot.users.get(name);
        if (user === undefined)
            throw new UsersFileError(`user ${name} not found`);
        snapshot.users.set(name, apply(user));
    });
}
async function addUser(ctx, name) {
    if (name === undefined || !USERNAME_RE.test(name) || !ctx.argv.includes("--password-stdin")) {
        return usage(ctx.io);
    }
    const [password = ""] = await ctx.io.readLines(1);
    if (password === "") {
        ctx.io.err("empty password");
        return 1;
    }
    const record = {
        passwordHash: await hashPassword(password),
        disabled: ctx.argv.includes("--disabled"),
        role: ctx.argv.includes("--admin") ? "admin" : "user",
        mustChangePassword: false,
    };
    const added = await mutate(ctx, (snapshot) => {
        if (snapshot.users.has(name))
            throw new UsersFileError(`user ${name} already exists`);
        snapshot.users.set(name, record);
    });
    if (!added)
        return 1;
    ctx.io.out(`user ${name} added`);
    return 0;
}
/** `user passwd <name>`：piped 一次会话读两行 / TTY 隐藏回显两次；策略 + hash + 锁内写盘（P1 §7）。 */
async function passwdUser(ctx, name) {
    if (name === undefined || !USERNAME_RE.test(name))
        return usage(ctx.io);
    if (ctx.argv.some(isPasswordFlag)) {
        ctx.io.err("refusing --password: use --password-stdin or an interactive prompt");
        return 1;
    }
    const user = await findUser(ctx, name);
    if (user === undefined)
        return 1;
    const password = await readNewPassword(ctx, ctx.argv.includes("--password-stdin"));
    if (password === undefined)
        return 1;
    const policy = await checkPasswordPolicy(password, {
        oldPasswordHash: user.passwordHash,
        verifyOld: (plain, stored) => verifyPassword(plain, stored),
    });
    if (!policy.ok) {
        ctx.io.err(`password rejected: ${policy.rules.join(", ")}`);
        return 1;
    }
    const hash = await hashPassword(password);
    // 有意不清 must_change_password（对比自助改密 POST /auth/password 会清）：CLI 是运维重置
    // 通道，`user passwd` 只换口令；「管理员重置 → 强制下次改密」的语义留给 P2（契约 §10）。
    if (!(await edit(ctx, name, (current) => ({ ...current, passwordHash: hash }))))
        return 1;
    ctx.io.out(`user ${name} password changed`);
    if (user.totpSecret !== undefined)
        ctx.io.out(TOTP_WARNING);
    return 0;
}
/** 锁外预读 users.yaml 快照；读失败 → 报错返回 undefined。 */
async function readSnapshot(ctx) {
    try {
        return (await loadUsersFile(ctx.file)).snapshot;
    }
    catch (error) {
        ctx.io.err(errorMessage(error));
        return undefined;
    }
}
/** 锁外预读用户（存在性检查；写盘前 edit 会在锁内再校验一次）。 */
async function findUser(ctx, name) {
    const snapshot = await readSnapshot(ctx);
    const user = snapshot?.users.get(name);
    if (user === undefined && snapshot !== undefined)
        ctx.io.err(`user ${name} not found`);
    return user;
}
/** 读新口令 + 确认：piped 走一次 readLines(2)，TTY 走注入的 io.readSecret 两次。 */
async function readNewPassword(ctx, fromStdin) {
    const tty = !fromStdin && process.stdin.isTTY === true;
    const secret = ctx.io.readSecret ?? readSecretFromTty;
    const [password = "", confirmation = ""] = tty
        ? [await secret("New password: "), await secret("Confirm new password: ")]
        : await ctx.io.readLines(2);
    if (password === "" || password !== confirmation) {
        ctx.io.err(password === "" ? "empty password" : "passwords do not match");
        return undefined;
    }
    return password;
}
/** `user role <name> <admin|user>`：唯一提权通道；末位 admin 由 store 不变量保护。 */
async function setRole(ctx, name, role) {
    if (name === undefined || !USERNAME_RE.test(name))
        return usage(ctx.io);
    if (role !== "admin" && role !== "user")
        return usage(ctx.io);
    if (!(await edit(ctx, name, (user) => ({ ...user, role }))))
        return 1;
    ctx.io.out(`user ${name} role set to ${role}`);
    return 0;
}
async function listUsers(ctx) {
    const snapshot = await readSnapshot(ctx);
    if (snapshot === undefined)
        return 1;
    for (const name of [...snapshot.users.keys()].sort(compareNames)) {
        const user = snapshot.users.get(name);
        if (user === undefined)
            continue;
        const admin = user.role === "admin" ? " (admin)" : "";
        ctx.io.out(`${name}${admin}${user.disabled ? " (disabled)" : ""}`);
    }
    return 0;
}
/** `dsh-auth skill install [--force]`：把包内配置速查技能装到 $DSH_HOME/skills/。 */
async function installSkillCommand(ctx) {
    const target = userSkillDir();
    const force = ctx.argv.includes("--force");
    const result = await installSkill({ sourceDir: bundledSkillDir(), targetDir: target, force });
    if (result.status === "source-missing") {
        ctx.io.err("bundled skill not found (package layout changed?)");
        return 1;
    }
    const current = result.status === "up-to-date";
    const note = current ? " (use --force to update)" : "";
    const verb = current ? "already installed at" : "installed to";
    ctx.io.out(`skill ${SKILL_NAME} ${verb} ${target}${note}`);
    return 0;
}
async function disableUser(ctx, name) {
    if (name === undefined)
        return usage(ctx.io);
    if (!(await edit(ctx, name, (user) => ({ ...user, disabled: true }))))
        return 1;
    ctx.io.out(`user ${name} disabled`);
    return 0;
}
function errorMessage(error) {
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