import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, type CliIo } from "./cli.js";
import { verifyPassword } from "./features/password/index.js";
import { loadUsersFile } from "./shared/index.js";

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
      readLine: () => Promise.resolve(queue.shift() ?? ""),
    },
  };
}

describe("dsh-auth user add", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-cli-"));
    file = path.join(dir, "users.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("adds a user with a verifiable hash and 0600 permissions", async () => {
    const { io, out, err } = makeIo(["s3cret"]);
    const code = await main(["user", "add", "alice", "--password-stdin", "--file", file], io);
    expect(code).toBe(0);
    expect(out).toEqual(["user alice added"]);
    expect(err).toEqual([]);
    const { snapshot } = await loadUsersFile(file);
    const alice = snapshot.users.get("alice");
    expect(alice?.disabled).toBe(false);
    await expect(verifyPassword("s3cret", alice!.passwordHash)).resolves.toBe(true);
    const stat = await fs.stat(file);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("supports --disabled", async () => {
    const { io } = makeIo(["pw"]);
    const code = await main(
      ["user", "add", "alice", "--password-stdin", "--disabled", "--file", file],
      io,
    );
    expect(code).toBe(0);
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.disabled).toBe(true);
  });

  it("creates the parent directory automatically", async () => {
    const nested = path.join(dir, "auth", "users.yaml");
    const { io } = makeIo(["pw"]);
    const code = await main(["user", "add", "alice", "--password-stdin", "--file", nested], io);
    expect(code).toBe(0);
    await expect(fs.stat(nested)).resolves.toBeDefined();
  });

  it("rejects missing --password-stdin", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "add", "alice", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("rejects invalid usernames", async () => {
    const { io, err } = makeIo(["pw"]);
    const code = await main(["user", "add", "bad name", "--password-stdin", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("rejects duplicate users", async () => {
    const { io } = makeIo(["pw"]);
    await main(["user", "add", "alice", "--password-stdin", "--file", file], io);
    const second = makeIo(["pw"]);
    const code = await main(
      ["user", "add", "alice", "--password-stdin", "--file", file],
      second.io,
    );
    expect(code).toBe(1);
    expect(second.err).toEqual(["user alice already exists"]);
  });

  it("rejects an empty password from stdin", async () => {
    const { io, err } = makeIo([""]);
    const code = await main(["user", "add", "alice", "--password-stdin", "--file", file], io);
    expect(code).toBe(1);
    expect(err).toEqual(["empty password"]);
  });
});

describe("dsh-auth user list", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-cli-"));
    file = path.join(dir, "users.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists users in lexicographic order with disabled markers", async () => {
    const bob = makeIo(["pw"]);
    await main(["user", "add", "bob", "--password-stdin", "--file", file], bob.io);
    const alice = makeIo(["pw"]);
    await main(
      ["user", "add", "alice", "--password-stdin", "--disabled", "--file", file],
      alice.io,
    );
    const list = makeIo();
    const code = await main(["user", "list", "--file", file], list.io);
    expect(code).toBe(0);
    expect(list.out).toEqual(["alice (disabled)", "bob"]);
  });

  it("prints nothing for a missing file and exits 0", async () => {
    const { io, out } = makeIo();
    const code = await main(["user", "list", "--file", file], io);
    expect(code).toBe(0);
    expect(out).toEqual([]);
  });
});

describe("dsh-auth user disable", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-cli-"));
    file = path.join(dir, "users.yaml");
    const { io } = makeIo(["pw"]);
    await main(["user", "add", "alice", "--password-stdin", "--file", file], io);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("disables an existing user", async () => {
    const { io, out } = makeIo();
    const code = await main(["user", "disable", "alice", "--file", file], io);
    expect(code).toBe(0);
    expect(out).toEqual(["user alice disabled"]);
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.disabled).toBe(true);
  });

  it("is idempotent for an already disabled user", async () => {
    const first = makeIo();
    await main(["user", "disable", "alice", "--file", file], first.io);
    const second = makeIo();
    const code = await main(["user", "disable", "alice", "--file", file], second.io);
    expect(code).toBe(0);
    expect(second.out).toEqual(["user alice disabled"]);
  });

  it("fails for an unknown user", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "disable", "ghost", "--file", file], io);
    expect(code).toBe(1);
    expect(err).toEqual(["user not found"]);
  });
});

describe("dsh-auth arg handling", () => {
  it("prints usage for unknown subcommands", async () => {
    const { io, err } = makeIo();
    const code = await main(["wat"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("prints usage for unknown user commands", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "explode"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("fails when --file has no value", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "list", "--file"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });
});

describe("dsh-auth skill install", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-cli-skill-"));
    // 隔离目标：userSkillDir 读 DSH_HOME；源从包内 .agents/skills 读（仓库根存在）。
    vi.stubEnv("DSH_HOME", dir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("installs the bundled config skill into $DSH_HOME/skills", async () => {
    const { io, out, err } = makeIo();
    const code = await main(["skill", "install"], io);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out.join("\n")).toContain(
      `installed to ${path.join(dir, "skills", "dsh-auth-gate-config")}`,
    );
    await expect(
      fs.readFile(path.join(dir, "skills", "dsh-auth-gate-config", "SKILL.md"), "utf8"),
    ).resolves.toContain("dsh-auth-gate 配置速查");
  });

  it("reports up-to-date on a second run and updates with --force", async () => {
    await main(["skill", "install"], makeIo().io);
    const second = makeIo();
    const code = await main(["skill", "install"], second.io);
    expect(code).toBe(0);
    expect(second.out.join("\n")).toContain("already installed");

    const forced = makeIo();
    const forcedCode = await main(["skill", "install", "--force"], forced.io);
    expect(forcedCode).toBe(0);
    expect(forced.out.join("\n")).toContain("installed to");
  });

  it("prints usage for unknown skill commands", async () => {
    const { io, err } = makeIo();
    const code = await main(["skill", "explode"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });
});
