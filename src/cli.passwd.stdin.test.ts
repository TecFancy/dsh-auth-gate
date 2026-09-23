import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, type CliIo } from "./cli.js";
import { verifyPassword } from "./features/password/index.js";
import { loadUsersFile } from "./shared/index.js";

/** 满足策略（≥14 位 + 四类字符）的口令。 */
const OLD_PASSWORD = "Old-Password-Ok!23";
const NEW_PASSWORD = "New-Password-Ok!23";

/**
 * 真实子进程用的解析钩子：源码的相对 import 按 TS 约定写 `.js`，node 直跑 `.ts`
 * 需要把它们落到 `.ts`（Node 22.15+ / 24 的 module.registerHooks；先原样、失败再试 .ts）。
 */
const RESOLVE_HOOK = `import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.endsWith(".js")) throw error;
      return nextResolve(specifier.slice(0, -3) + ".ts", context);
    }
  },
});
`;

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.ts");

interface Harness {
  io: CliIo;
  out: string[];
  err: string[];
  /** TTY 路径的提示语记录（证明确实走了注入流）。 */
  prompts: string[];
}

/** 假流 IO：readLines 取 lines 队列，readSecret 取 secrets 队列。 */
function makeIo(lines: string[] = [], secrets: string[] = []): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const queued = [...lines];
  const queuedSecrets = [...secrets];
  return {
    out,
    err,
    prompts,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      readLines: (count: number) => Promise.resolve(queued.splice(0, count)),
      readSecret: (prompt) => {
        prompts.push(prompt);
        return Promise.resolve(queuedSecrets.shift() ?? "");
      },
    },
  };
}

/** 把 process.stdin 伪装成 TTY（测试后恢复：删掉实例属性露出原型 getter）。 */
async function withTty<T>(run: () => Promise<T>): Promise<T> {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  try {
    return await run();
  } finally {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
}

async function addUser(file: string, name: string): Promise<void> {
  const h = makeIo([OLD_PASSWORD]);
  expect(await main(["user", "add", name, "--password-stdin", "--file", file], h.io)).toBe(0);
}

async function hashOf(file: string, name: string): Promise<string> {
  const { snapshot } = await loadUsersFile(file);
  return snapshot.users.get(name)!.passwordHash;
}

/** 真实子进程：`node --import <hook> src/cli.ts …`，stdin 写入 input（模拟 printf 管道）。 */
async function runRealCli(
  dir: string,
  args: string[],
  input: string,
): Promise<{ code: number | null; out: string; err: string }> {
  const hook = path.join(dir, "resolve-js.mjs");
  await fs.writeFile(hook, RESOLVE_HOOK);
  // `--import` 收的是**模块 specifier**：Windows 上直接喂 `C:\…` 会被当成 scheme `c:`，
  // 子进程抛 ERR_UNSUPPORTED_ESM_URL_SCHEME（Linux 恰好能过，所以只在 windows-latest 红）。
  // 入口脚本反过来要给**路径**：Node 会自己转成 file URL，喂 URL 反被 resolve 钩子按相对路径拼接。
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(hook).href, CLI_PATH, ...args],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

describe("dsh-auth user passwd - piped stdin (real subprocess)", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-stdin-"));
    file = path.join(dir, "users.yaml");
    await addUser(file, "alice");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads both piped lines in one session and changes the password", async () => {
    const args = ["user", "passwd", "alice", "--file", file];
    const result = await runRealCli(dir, args, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`);
    expect(result.code).toBe(0);
    expect(result.out).toContain("user alice password changed");
    expect(result.err).not.toContain("passwords do not match");
    await expect(verifyPassword(NEW_PASSWORD, await hashOf(file, "alice"))).resolves.toBe(true);
  }, 30_000);

  it("exits 1 on a real mismatch and keeps the old hash", async () => {
    const args = ["user", "passwd", "alice", "--file", file];
    const result = await runRealCli(dir, args, `${NEW_PASSWORD}\nOther-Password!23\n`);
    expect(result.code).toBe(1);
    expect(result.err).toContain("passwords do not match");
    await expect(verifyPassword(OLD_PASSWORD, await hashOf(file, "alice"))).resolves.toBe(true);
  }, 30_000);
});

describe("dsh-auth user passwd - TTY branch (injected stream)", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-tty-"));
    file = path.join(dir, "users.yaml");
    await addUser(file, "alice");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads the password twice from the injected stream, not stdin", async () => {
    const h = makeIo([], [NEW_PASSWORD, NEW_PASSWORD]);
    const code = await withTty(async () => main(["user", "passwd", "alice", "--file", file], h.io));
    expect(code).toBe(0);
    expect(h.prompts).toEqual(["New password: ", "Confirm new password: "]);
    expect(h.out).toEqual(["user alice password changed"]);
    await expect(verifyPassword(NEW_PASSWORD, await hashOf(file, "alice"))).resolves.toBe(true);
  });

  it("rejects a mismatch on the injected stream", async () => {
    const h = makeIo([], [NEW_PASSWORD, "Other-Password!23"]);
    const code = await withTty(async () => main(["user", "passwd", "alice", "--file", file], h.io));
    expect(code).toBe(1);
    expect(h.err).toEqual(["passwords do not match"]);
    expect(h.prompts).toHaveLength(2);
  });

  it("keeps the piped read when --password-stdin is given on a TTY", async () => {
    const h = makeIo([NEW_PASSWORD, NEW_PASSWORD], []);
    const args = ["user", "passwd", "alice", "--password-stdin", "--file", file];
    expect(await withTty(() => main(args, h.io))).toBe(0);
    expect(h.prompts).toEqual([]);
  });
});
