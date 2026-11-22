import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, type CliIo } from "./cli.js";
import { loadUsersFile } from "./host/entities/user/index.js";

/** 满足口令策略（≥14 位 + 四类字符）的测试口令。 */
const CLI_PASSWORD = "Cli-Password-Ok!23";

function makeIo(lines: string[] = []): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...lines];
  return {
    out,
    err,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      readLines: (count: number) => Promise.resolve(queue.splice(0, count)),
    },
  };
}

describe("dsh-auth CLI input validation (L5/L8)", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-cli-validation-"));
    file = path.join(dir, "users.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects invalid usernames", async () => {
    // `bootstrap` 是预留名（引导会话 sentinel，G12），大小写不敏感一并拒绝。
    for (const name of ["bad name", "bootstrap", "BootStrap"]) {
      const { io, err } = makeIo([CLI_PASSWORD]);
      const code = await main(["user", "add", name, "--password-stdin", "--file", file], io);
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("Usage:");
    }
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("user add rejects a password that violates the shared policy and writes nothing", async () => {
    const { io, err } = makeIo(["short"]);
    const code = await main(["user", "add", "alice", "--password-stdin", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("password rejected");
    expect(err.join("\n")).toContain("minLength");
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("user add records an ISO passwordChangedAt for the new credential", async () => {
    const { io } = makeIo([CLI_PASSWORD]);
    expect(await main(["user", "add", "alice", "--password-stdin", "--file", file], io)).toBe(0);
    const { snapshot } = await loadUsersFile(file);
    const changedAt = snapshot.users.get("alice")?.passwordChangedAt ?? "";
    expect(Number.isFinite(Date.parse(changedAt))).toBe(true);
    expect(new Date(changedAt).toISOString()).toBe(changedAt);
  });

  it("user disable/enable rejects an invalid username with usage (L8)", async () => {
    for (const command of ["disable", "enable"]) {
      const { io, err } = makeIo();
      const code = await main(["user", command, "bad name", "--file", file], io);
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("Usage:");
    }
    // 非法名不得被当作「找不到的用户」去尝试加锁/写盘。
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
