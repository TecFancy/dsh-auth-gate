import { spawn } from "node:child_process";
import { mkdtempSync, promises as fs, rmSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInvokedEntry } from "./proxy-cli.js";

const ENTRY_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "proxy-cli.ts");
const ENTRY_URL = pathToFileURL(ENTRY_PATH).href;

/**
 * 平台是否允许建文件符号链接。Windows 需要 Developer Mode 或提权，托管 runner 常会 EPERM：
 * 那时只跳过依赖链接的用例，真实路径与导入方两条仍要在 Windows 上跑（它们验的是同一比较逻辑）。
 */
const SYMLINKS_SUPPORTED = (() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dsh-auth-proxy-probe-"));
  try {
    const probe = path.join(dir, "probe");
    symlinkSync(ENTRY_PATH, probe, "file");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

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

/** 真实子进程：`node --import <hook> …args`，收集 stdout/stderr/退出码。 */
async function runNode(
  dir: string,
  args: string[],
): Promise<{ code: number | null; out: string; err: string }> {
  const hook = path.join(dir, "resolve-js.mjs");
  await fs.writeFile(hook, RESOLVE_HOOK);
  // `--import` 收模块 specifier，入口脚本收路径（见 cli.passwd.stdin.test.ts 的同款注释）。
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(hook).href, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  });
}

describe("isInvokedEntry", () => {
  it("accepts the real file path", () => {
    expect(isInvokedEntry(ENTRY_URL, ENTRY_PATH)).toBe(true);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)("accepts a symlinked bin path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-proxy-unit-"));
    const link = path.join(dir, "dsh-auth-proxy");
    try {
      await fs.symlink(ENTRY_PATH, link, "file");
      expect(isInvokedEntry(ENTRY_URL, link)).toBe(true);
      // 夹具自检：链接路径与真实路径的字符串确实不同，正例才不是白捡的。这行不执行生产代码。
      expect(ENTRY_URL === pathToFileURL(link).href).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns false when argv[1] is missing or empty", () => {
    expect(isInvokedEntry(ENTRY_URL, undefined)).toBe(false);
    expect(isInvokedEntry(ENTRY_URL, "")).toBe(false);
  });

  it("rejects another existing file", () => {
    const other = path.join(path.dirname(ENTRY_PATH), "proxy-cli.test.ts");
    expect(isInvokedEntry(ENTRY_URL, other)).toBe(false);
  });

  it("returns false when the path does not resolve", () => {
    expect(isInvokedEntry(ENTRY_URL, path.join(os.tmpdir(), "dsh-auth-proxy-missing.js"))).toBe(
      false,
    );
  });
});

describe("dsh-auth-proxy entry guard (real subprocess)", () => {
  let dir: string;
  let link: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-proxy-entry-"));
    link = path.join(dir, "dsh-auth-proxy");
    if (SYMLINKS_SUPPORTED) await fs.symlink(ENTRY_PATH, link, "file");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!SYMLINKS_SUPPORTED)(
    "runs main through a symlinked bin path and prints usage",
    async () => {
      const result = await runNode(dir, [link, "--help"]);
      expect(result.code).toBe(0);
      expect(result.out).toContain("Usage:");
      expect(result.out).toContain("--target <upstream-url>");
      expect(result.err).not.toContain("Uncaught");
    },
    30_000,
  );

  it.skipIf(!SYMLINKS_SUPPORTED)(
    "reports a missing --target through the symlink instead of exiting silently",
    async () => {
      const result = await runNode(dir, [link]);
      expect(result.code).toBe(1);
      expect(result.err).toContain("--target is required");
    },
    30_000,
  );

  it("runs main from the real path too", async () => {
    const result = await runNode(dir, [ENTRY_PATH, "--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage:");
  }, 30_000);

  it("does not crash an importer whose argv[1] is not a file path", async () => {
    const script = `import(${JSON.stringify(ENTRY_URL)}).then(() => console.log("import ok"));`;
    const result = await runNode(dir, ["-e", script, "somearg"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("import ok");
    expect(result.err).not.toContain("ENOENT");
  }, 30_000);
});
