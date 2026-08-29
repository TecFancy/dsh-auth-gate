import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill } from "./skill-install.js";

/** 在 tmp 下构造源/目标目录，返回路径与释放函数。 */
function makeDirs(): { source: string; target: string; cleanup: () => Promise<void> } {
  const root = path.join(os.tmpdir(), `dsh-auth-skill-${Math.random().toString(36).slice(2)}`);
  const source = path.join(root, "source", "dsh-auth-gate-config");
  const target = path.join(root, "target", "dsh-auth-gate-config");
  return {
    source,
    target,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("dsh-auth skill install (installSkill)", () => {
  let dirs: ReturnType<typeof makeDirs>;

  beforeEach(async () => {
    dirs = makeDirs();
    await fs.mkdir(dirs.source, { recursive: true });
    await fs.writeFile(path.join(dirs.source, "SKILL.md"), "v1 content\n");
  });

  afterEach(async () => {
    await dirs.cleanup();
  });

  it("copies the bundled skill directory on a fresh install", async () => {
    const result = await installSkill({
      sourceDir: dirs.source,
      targetDir: dirs.target,
      force: false,
    });
    expect(result.status).toBe("installed");
    await expect(fs.readFile(path.join(dirs.target, "SKILL.md"), "utf8")).resolves.toBe(
      "v1 content\n",
    );
  });

  it("skips without overwriting when the target already exists", async () => {
    await installSkill({ sourceDir: dirs.source, targetDir: dirs.target, force: false });
    await fs.writeFile(path.join(dirs.target, "SKILL.md"), "user tweak\n");
    const result = await installSkill({
      sourceDir: dirs.source,
      targetDir: dirs.target,
      force: false,
    });
    expect(result.status).toBe("up-to-date");
    // 用户对技能文件的本地修改必须保留（无 --force 不覆盖）。
    await expect(fs.readFile(path.join(dirs.target, "SKILL.md"), "utf8")).resolves.toBe(
      "user tweak\n",
    );
  });

  it("overwrites on --force", async () => {
    await installSkill({ sourceDir: dirs.source, targetDir: dirs.target, force: false });
    await fs.writeFile(path.join(dirs.source, "SKILL.md"), "v2 content\n");
    const result = await installSkill({
      sourceDir: dirs.source,
      targetDir: dirs.target,
      force: true,
    });
    expect(result.status).toBe("installed");
    await expect(fs.readFile(path.join(dirs.target, "SKILL.md"), "utf8")).resolves.toBe(
      "v2 content\n",
    );
  });

  it("reports source-missing when the package layout lacks the skill", async () => {
    const result = await installSkill({
      sourceDir: path.join(dirs.source, "does-not-exist"),
      targetDir: dirs.target,
      force: false,
    });
    expect(result.status).toBe("source-missing");
    await expect(fs.stat(dirs.target)).rejects.toThrow();
  });
});
