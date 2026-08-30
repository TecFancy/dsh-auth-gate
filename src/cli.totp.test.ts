import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, type CliIo } from "./cli.js";
import { base32Decode } from "./features/totp/index.js";
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

describe("dsh-auth user totp", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-totp-cli-"));
    file = path.join(dir, "users.yaml");
    const { io } = makeIo(["pw"]);
    await main(["user", "add", "alice", "--password-stdin", "--file", file], io);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("enable: writes a 32-char base32 secret and prints otpauth URI", async () => {
    const { io, out, err } = makeIo();
    const code = await main(["user", "totp", "enable", "alice", "--file", file], io);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    const secret = /TOTP secret for alice: ([A-Z2-7]{32})/.exec(out.join("\n"))?.[1];
    expect(secret).toBeDefined();
    expect(out.join("\n")).toContain(
      `otpauth://totp/${encodeURIComponent("dsh-auth:alice")}?secret=${secret}&issuer=${encodeURIComponent("dsh-auth")}`,
    );
    expect(base32Decode(secret!).length).toBe(20);
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.totpSecret).toBe(secret);
  });

  it("enable: rejects a user that already has a secret", async () => {
    const first = makeIo(["pw"]);
    await main(["user", "totp", "enable", "alice", "--file", file], first.io);
    const { io, err } = makeIo();
    const code = await main(["user", "totp", "enable", "alice", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("already has a TOTP secret");
  });

  it("enable: rejects unknown user", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "totp", "enable", "nobody", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("not found");
  });

  it("enable: rejects invalid username", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "totp", "enable", "1bad name!", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("disable: removes the secret (idempotent)", async () => {
    await main(["user", "totp", "enable", "alice", "--file", file], makeIo().io);
    const { io } = makeIo(["pw"]);
    const code = await main(["user", "totp", "disable", "alice", "--file", file], io);
    expect(code).toBe(0);
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.totpSecret).toBeUndefined();
    // 幂等：再次 disable 成功
    const again = makeIo(["pw"]);
    const code2 = await main(["user", "totp", "disable", "alice", "--file", file], again.io);
    expect(code2).toBe(0);
    expect(again.out.join("\n")).toContain("TOTP disabled");
  });

  it("disable: rejects unknown user", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "totp", "disable", "nobody", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("not found");
  });

  it("unknown totp subcommand: usage error", async () => {
    const { io, err } = makeIo();
    const code = await main(["user", "totp", "frobnicate", "alice", "--file", file], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Usage:");
  });
});
