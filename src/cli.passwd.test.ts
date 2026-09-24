import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, type CliIo } from "./cli.js";
import { verifyPassword } from "./features/password/index.js";
import { loadUsersFile } from "./shared/index.js";

/** 满足策略（≥14 位 + 四类字符）的口令。 */
const OLD_PASSWORD = "Old-Password-Ok!23";
const NEW_PASSWORD = "New-Password-Ok!23";

interface Harness {
  io: CliIo;
  out: string[];
  err: string[];
}

/** 假流 IO：readLines 按需取行（队列空 = EOF，返回空数组，与真实 stdin 一致）。 */
function makeIo(lines: string[] = []): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const queued = [...lines];
  return {
    out,
    err,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      readLines: (count: number) => Promise.resolve(queued.splice(0, count)),
    },
  };
}

async function addUser(file: string, name: string, extra: string[] = []): Promise<void> {
  const h = makeIo([OLD_PASSWORD]);
  const args = ["user", "add", name, "--password-stdin", ...extra, "--file", file];
  expect(await main(args, h.io)).toBe(0);
}

async function hashOf(file: string, name: string): Promise<string> {
  const { snapshot } = await loadUsersFile(file);
  const user = snapshot.users.get(name);
  return user!.passwordHash;
}

describe("dsh-auth user passwd", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-passwd-"));
    file = path.join(dir, "users.yaml");
    await addUser(file, "alice");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("changes the password from piped stdin (two lines) and the new hash verifies", async () => {
    const h = makeIo([NEW_PASSWORD, NEW_PASSWORD]);
    const code = await main(["user", "passwd", "alice", "--file", file], h.io);
    expect(code).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual(["user alice password changed"]);
    const hash = await hashOf(file, "alice");
    await expect(verifyPassword(NEW_PASSWORD, hash)).resolves.toBe(true);
    await expect(verifyPassword(OLD_PASSWORD, hash)).resolves.toBe(false);
  });

  it("accepts --password-stdin as an explicit piped read", async () => {
    const h = makeIo([NEW_PASSWORD, NEW_PASSWORD]);
    const code = await main(["user", "passwd", "alice", "--password-stdin", "--file", file], h.io);
    expect(code).toBe(0);
    await expect(verifyPassword(NEW_PASSWORD, await hashOf(file, "alice"))).resolves.toBe(true);
  });

  it("rejects a mismatched confirmation and keeps the old hash", async () => {
    const h = makeIo([NEW_PASSWORD, "Other-Password!23"]);
    const code = await main(["user", "passwd", "alice", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err).toEqual(["passwords do not match"]);
    await expect(verifyPassword(OLD_PASSWORD, await hashOf(file, "alice"))).resolves.toBe(true);
  });

  it("rejects an empty new password", async () => {
    const h = makeIo(["", ""]);
    const code = await main(["user", "passwd", "alice", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err).toEqual(["empty password"]);
  });

  it("rejects an unknown user and never creates it", async () => {
    const h = makeIo([NEW_PASSWORD, NEW_PASSWORD]);
    const code = await main(["user", "passwd", "ghost", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err).toEqual(["user ghost not found"]);
    expect((await loadUsersFile(file)).snapshot.users.has("ghost")).toBe(false);
  });

  it("refuses a plaintext --password argument in both spellings", async () => {
    const spaced = makeIo([OLD_PASSWORD, OLD_PASSWORD]);
    const args = ["user", "passwd", "alice", "--password", NEW_PASSWORD, "--file", file];
    expect(await main(args, spaced.io)).toBe(1);
    expect(spaced.err.join("\n")).toContain("refusing --password");
    const inline = makeIo([OLD_PASSWORD, OLD_PASSWORD]);
    const inlineArgs = ["user", "passwd", "alice", `--password=${NEW_PASSWORD}`, "--file", file];
    expect(await main(inlineArgs, inline.io)).toBe(1);
    expect(inline.err.join("\n")).toContain("refusing --password");
    await expect(verifyPassword(OLD_PASSWORD, await hashOf(file, "alice"))).resolves.toBe(true);
  });

  it("warns when the user has TOTP enabled", async () => {
    const totp = makeIo();
    expect(await main(["user", "totp", "enable", "alice", "--file", file], totp.io)).toBe(0);
    const h = makeIo([NEW_PASSWORD, NEW_PASSWORD]);
    expect(await main(["user", "passwd", "alice", "--file", file], h.io)).toBe(0);
    expect(h.out.join("\n")).toContain("user alice password changed");
    expect(h.out.join("\n")).toContain("TOTP");
  });

  it("fails with usage when the username is missing", async () => {
    const h = makeIo([NEW_PASSWORD, NEW_PASSWORD]);
    const code = await main(["user", "passwd", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("Usage:");
  });
});

describe("dsh-auth user passwd - new password policy", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-policy-"));
    file = path.join(dir, "users.yaml");
    await addUser(file, "alice");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects a policy failure (minLength) and keeps the old hash", async () => {
    const h = makeIo(["short", "short"]);
    const code = await main(["user", "passwd", "alice", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("password rejected");
    expect(h.err.join("\n")).toContain("minLength");
    await expect(verifyPassword(OLD_PASSWORD, await hashOf(file, "alice"))).resolves.toBe(true);
  });

  it("rejects the current password via the sameAsOld rule", async () => {
    const h = makeIo([OLD_PASSWORD, OLD_PASSWORD]);
    const code = await main(["user", "passwd", "alice", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("sameAsOld");
  });
});

describe("dsh-auth user role", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-role-"));
    file = path.join(dir, "users.yaml");
    await addUser(file, "alice");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("grants and revokes admin, and list marks it", async () => {
    await addUser(file, "root", ["--admin"]);
    const grant = makeIo();
    expect(await main(["user", "role", "alice", "admin", "--file", file], grant.io)).toBe(0);
    expect(grant.out).toEqual(["user alice role set to admin"]);
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.role).toBe("admin");
    const marked = makeIo();
    await main(["user", "list", "--file", file], marked.io);
    expect(marked.out).toEqual(["alice (admin)", "root (admin)"]);
    const revoke = makeIo();
    expect(await main(["user", "role", "alice", "user", "--file", file], revoke.io)).toBe(0);
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.role).toBe("user");
    const plain = makeIo();
    await main(["user", "list", "--file", file], plain.io);
    expect(plain.out).toEqual(["alice", "root (admin)"]);
  });

  it("rejects an unknown user without creating it", async () => {
    const h = makeIo();
    const code = await main(["user", "role", "ghost", "admin", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err).toEqual(["user ghost not found"]);
    expect((await loadUsersFile(file)).snapshot.users.has("ghost")).toBe(false);
  });

  it("rejects an invalid role with usage", async () => {
    const h = makeIo();
    const code = await main(["user", "role", "alice", "superuser", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("Usage:");
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.role).toBe("user");
  });

  it("refuses to demote the last active admin", async () => {
    await main(["user", "role", "alice", "admin", "--file", file], makeIo().io);
    const h = makeIo();
    const code = await main(["user", "role", "alice", "user", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("cannot remove the last admin");
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.role).toBe("admin");
  });

  it("allows demoting an admin while another active admin remains", async () => {
    await addUser(file, "root", ["--admin"]);
    await main(["user", "role", "alice", "admin", "--file", file], makeIo().io);
    const h = makeIo();
    expect(await main(["user", "role", "alice", "user", "--file", file], h.io)).toBe(0);
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.role).toBe("user");
  });

  it("grants admin through user add --admin", async () => {
    await addUser(file, "root", ["--admin"]);
    expect((await loadUsersFile(file)).snapshot.users.get("root")?.role).toBe("admin");
    const list = makeIo();
    await main(["user", "list", "--file", file], list.io);
    expect(list.out.join("\n")).toContain("root (admin)");
  });

  it("refuses to disable the last active admin", async () => {
    await addUser(file, "root", ["--admin"]);
    const h = makeIo();
    const code = await main(["user", "disable", "root", "--file", file], h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("cannot remove the last admin");
    const user = (await loadUsersFile(file)).snapshot.users.get("root");
    expect(user?.disabled).toBe(false);
  });
});
