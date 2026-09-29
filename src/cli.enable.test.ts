import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, type CliIo } from "./cli.js";
import { loadUsersFile } from "./shared/index.js";

/**
 * P2：`dsh-auth user enable <name>`（契约 §8-B 第 19 条）。
 * 拆出独立文件是为了守住 `src/cli.test.ts` 的 max-lines 250（root 文件在
 * `scripts/verify-slice-boundaries.mjs` 的 ROOT_FILES 已登记）。
 */
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

describe("dsh-auth user enable", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-cli-enable-"));
    file = path.join(dir, "users.yaml");
    const { io } = makeIo(["pw"]);
    await main(["user", "add", "alice", "--password-stdin", "--disabled", "--file", file], io);
    await main(["user", "role", "alice", "admin", "--file", file], makeIo().io);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("re-enables a disabled user and keeps every other field", async () => {
    const before = (await loadUsersFile(file)).snapshot.users.get("alice");
    expect(before?.disabled).toBe(true);

    const { io, out, err } = makeIo();
    const code = await main(["user", "enable", "alice", "--file", file], io);

    expect(code).toBe(0);
    expect(out).toEqual(["user alice enabled"]);
    expect(err).toEqual([]);
    const after = (await loadUsersFile(file)).snapshot.users.get("alice");
    // role / totpSecret / must_change_password / passwordHash 一律原样保留。
    expect(after).toEqual({ ...before, disabled: false });
    expect(after?.role).toBe("admin");
  });

  it("is idempotent for an already enabled user", async () => {
    await main(["user", "enable", "alice", "--file", file], makeIo().io);
    const second = makeIo();
    const code = await main(["user", "enable", "alice", "--file", file], second.io);
    expect(code).toBe(0);
    expect(second.out).toEqual(["user alice enabled"]);
  });

  it("fails for an unknown user", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "enable", "ghost", "--file", file], io);
    expect(code).toBe(1);
    expect(err).toEqual(["user ghost not found"]);
  });
});
