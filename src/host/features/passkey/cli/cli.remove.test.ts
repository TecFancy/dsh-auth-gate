import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUsersFile, type PasskeyRecord } from "../../../entities/user/index.js";
import { handlePasskeyCli } from "./cli.js";
import {
  CRED_A,
  CRED_B,
  CRED_C,
  HANDLE,
  makeIo,
  makeTempUsersFile,
  passkey,
  seed,
  seedThree,
} from "../../../../../test/passkey-cli-harness.js";

let dir: string;
let file: string;

beforeEach(async () => {
  ({ dir, file } = await makeTempUsersFile());
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function passkeysOf(name: string): Promise<PasskeyRecord[]> {
  return (await loadUsersFile(file)).snapshot.users.get(name)?.passkeys ?? [];
}

describe("dsh-auth passkey rm --id", () => {
  it("removes the unique prefix match and keeps the rest", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: CRED_A }, h.io)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual(["removed passkey MacBook Touch ID from alice"]);
    expect((await passkeysOf("alice")).map((passkey) => passkey.credentialId)).toEqual([
      CRED_B,
      CRED_C,
    ]);
  });

  it("trims the prefix before matching", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: `  ${CRED_A}  ` }, h.io)).toBe(0);
    expect(h.out).toEqual(["removed passkey MacBook Touch ID from alice"]);
  });

  it("rejects a prefix shorter than 8 characters", async () => {
    await seedThree(file);
    const before = await fs.readFile(file, "utf8");
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: "AAAABBB" }, h.io)).toBe(1);
    expect(h.err).toEqual(["--id must be at least 8 characters"]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("reports a prefix without matches and leaves the file untouched", async () => {
    await seedThree(file);
    const before = await fs.readFile(file, "utf8");
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: "99999999" }, h.io)).toBe(1);
    expect(h.err).toEqual(["no passkey matches 99999999"]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("reports an ambiguous prefix and leaves the file untouched", async () => {
    await seedThree(file);
    const before = await fs.readFile(file, "utf8");
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: "AAAABBBB" }, h.io)).toBe(1);
    expect(h.err).toEqual(["passkey id prefix is ambiguous (2 matches)"]);
    expect(await passkeysOf("alice")).toHaveLength(3);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
});

describe("dsh-auth passkey rm --id edge cases", () => {
  it("matches credential ids case-sensitively", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: "aaaabbbbccccdddd" }, h.io)).toBe(1);
    expect(h.err).toEqual(["no passkey matches aaaabbbbccccdddd"]);
  });

  it("refuses to remove the last passkey without --force", async () => {
    await seed(file, "alice", [passkey()]);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: CRED_A }, h.io)).toBe(1);
    expect(h.err).toEqual([
      "refusing to remove the last passkey of alice: with passkey-only enabled this locks the " +
        "account out. Add another passkey first, or re-run with --force",
    ]);
    // 拒绝发生在写盘之前：凭据与 handle 都原样保留。
    expect(await passkeysOf("alice")).toHaveLength(1);
  });

  it("removes the last passkey with --force and keeps the user handle", async () => {
    await seed(file, "alice", [passkey()]);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: CRED_A, force: true }, h.io)).toBe(0);
    expect(h.out).toEqual([
      "removed passkey MacBook Touch ID from alice",
      "warning: alice has no passkeys left",
    ]);
    const user = (await loadUsersFile(file)).snapshot.users.get("alice");
    expect(user?.passkeys).toEqual([]);
    expect(user?.passkeyUserHandle).toBe(HANDLE);
  });

  it("reports an unknown user without creating it", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: CRED_A }, h.io)).toBe(1);
    expect(h.err).toEqual(["user alice not found"]);
    await expect(fs.stat(file)).rejects.toBeInstanceOf(Error);
  });

  it("refuses --id together with --all", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: CRED_A, all: true }, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
    expect(await passkeysOf("alice")).toHaveLength(3);
  });

  it("requires either --id or --all", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", {}, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
  });

  it("prints usage without a user name", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", undefined, { all: true }, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
  });
});

describe("dsh-auth passkey rm --all", () => {
  it("refuses --all without --force", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { all: true }, h.io)).toBe(1);
    expect(h.err).toEqual([
      "refusing to remove the last passkey of alice: with passkey-only enabled this locks the " +
        "account out. Add another passkey first, or re-run with --force",
    ]);
    expect(await passkeysOf("alice")).toHaveLength(3);
  });

  it("removes every passkey with --force and reports the count", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { all: true, force: true }, h.io)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual(["removed 3 passkeys from alice"]);
    expect(await passkeysOf("alice")).toEqual([]);
  });

  it("is harmless for a user without passkeys", async () => {
    await seed(file, "alice", []);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { all: true }, h.io)).toBe(0);
    expect(h.out).toEqual(["removed 0 passkeys from alice"]);
  });

  it("reports an unknown user", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { all: true }, h.io)).toBe(1);
    expect(h.err).toEqual(["user alice not found"]);
  });

  it("surfaces a users file load error", async () => {
    await fs.writeFile(file, "users: [unclosed", { mode: 0o600 });
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { all: true }, h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("invalid users file");
  });
});
