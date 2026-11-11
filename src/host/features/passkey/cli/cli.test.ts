import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadUsersFile,
  mutateUsersFile,
  type PasskeyRecord,
} from "../../../entities/user/index.js";
import { handlePasskeyCli, type PasskeyCliIo } from "./cli.js";

interface Harness {
  io: PasskeyCliIo;
  out: string[];
  err: string[];
}

function makeIo(): Harness {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

/** 32 字节随机 handle 的 base64url 形状（同一用户在测试内复用）。 */
const HANDLE = Buffer.alloc(32, 7).toString("base64url");
const COSE_KEY = Buffer.alloc(77, 2).toString("base64url");

/** 固定时间（UTC），让 list 的 ISO 格式成为可钉死的契约。 */
const CREATED = Date.UTC(2025, 0, 2, 3, 4, 5); // 2025-01-02T03:04:05.000Z
const LAST_USED = Date.UTC(2025, 1, 3, 4, 5, 6); // 2025-02-03T04:05:06.000Z

/** 三把凭据；前两把共享 12 字符前缀，用于歧义与截断断言。 */
const CRED_A = "AAAABBBBCCCCDDDD";
const CRED_B = "AAAABBBBCCCCEEEE";
const CRED_C = "1111222233334444";

const AAGUID = "d548826e-79b4-db40-a3d8-11116f7e8349";

function passkey(overrides: Partial<PasskeyRecord> = {}): PasskeyRecord {
  return {
    credentialId: CRED_A,
    publicKeyCose: COSE_KEY,
    alg: -7,
    signCount: 3,
    aaguid: AAGUID,
    be: false,
    bs: true,
    uvInitialized: true,
    transports: ["internal", "hybrid"],
    label: "MacBook Touch ID",
    createdAt: CREATED,
    lastUsedAt: LAST_USED,
    ...overrides,
  };
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-passkey-cli-"));
  file = path.join(dir, "users.yaml");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** 锁内落一份 users.yaml（0600），凭据形状由调用方固定。 */
async function seed(name: string, passkeys: PasskeyRecord[]): Promise<void> {
  await mutateUsersFile(file, (snapshot) => {
    snapshot.users.set(name, {
      passwordHash: "scrypt$seed$hash",
      disabled: false,
      role: "user",
      mustChangePassword: false,
      passkeyUserHandle: HANDLE,
      passkeys,
    });
  });
}

/** 同一用户三把凭据：两种 transport 形状、两种 BE/BS、never 与已用时间各一。 */
async function seedThree(): Promise<void> {
  await seed("alice", [
    passkey(),
    passkey({
      credentialId: CRED_B,
      label: "Phone",
      be: true,
      bs: false,
      transports: [],
      lastUsedAt: 0,
    }),
    passkey({ credentialId: CRED_C, label: "Backup", transports: ["usb"] }),
  ]);
}

async function passkeysOf(name: string): Promise<PasskeyRecord[]> {
  return (await loadUsersFile(file)).snapshot.users.get(name)?.passkeys ?? [];
}

describe("dsh-auth passkey list", () => {
  it("prints one fixed-shape line per passkey and truncates the credential id", async () => {
    await seedThree();
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual([
      "MacBook Touch ID · id=AAAABBBBCCCC… · created=2025-01-02T03:04:05.000Z · last-used=2025-02-03T04:05:06.000Z · be=false bs=true · transports=internal,hybrid",
      "Phone · id=AAAABBBBCCCC… · created=2025-01-02T03:04:05.000Z · last-used=never · be=true bs=false · transports=-",
      "Backup · id=111122223333… · created=2025-01-02T03:04:05.000Z · last-used=2025-02-03T04:05:06.000Z · be=false bs=true · transports=usb",
    ]);
    expect(h.out.join("\n")).not.toContain(CRED_A);
  });

  it("reports a user without passkeys without failing", async () => {
    await seed("alice", []);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(0);
    expect(h.out).toEqual(["no passkeys for alice"]);
  });

  it("reports an unknown user", async () => {
    await seedThree();
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "ghost", {}, h.io)).toBe(1);
    expect(h.err).toEqual(["user ghost not found"]);
  });

  it("reports a missing users file as an unknown user", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(1);
    expect(h.err).toEqual(["user alice not found"]);
  });

  it("surfaces a users file load error", async () => {
    await fs.writeFile(file, "users: [unclosed", { mode: 0o600 });
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("invalid users file");
  });

  it("prints usage without a user name", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", undefined, {}, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
  });
});

describe("dsh-auth passkey rm --id", () => {
  it("removes the unique prefix match and keeps the rest", async () => {
    await seedThree();
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
    await seedThree();
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: `  ${CRED_A}  ` }, h.io)).toBe(0);
    expect(h.out).toEqual(["removed passkey MacBook Touch ID from alice"]);
  });

  it("rejects a prefix shorter than 8 characters", async () => {
    await seedThree();
    const before = await fs.readFile(file, "utf8");
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: "AAAABBB" }, h.io)).toBe(1);
    expect(h.err).toEqual(["--id must be at least 8 characters"]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("reports a prefix without matches and leaves the file untouched", async () => {
    await seedThree();
    const before = await fs.readFile(file, "utf8");
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: "99999999" }, h.io)).toBe(1);
    expect(h.err).toEqual(["no passkey matches 99999999"]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("reports an ambiguous prefix and leaves the file untouched", async () => {
    await seedThree();
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
    await seedThree();
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: "aaaabbbbccccdddd" }, h.io)).toBe(1);
    expect(h.err).toEqual(["no passkey matches aaaabbbbccccdddd"]);
  });

  it("warns when the last passkey is removed but keeps the user handle", async () => {
    await seed("alice", [passkey()]);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: CRED_A }, h.io)).toBe(0);
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
    await seedThree();
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { id: CRED_A, all: true }, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
    expect(await passkeysOf("alice")).toHaveLength(3);
  });

  it("requires either --id or --all", async () => {
    await seedThree();
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
  it("removes every passkey and reports the count", async () => {
    await seedThree();
    const h = makeIo();
    expect(await handlePasskeyCli(file, "rm", "alice", { all: true }, h.io)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual(["removed 3 passkeys from alice"]);
    expect(await passkeysOf("alice")).toEqual([]);
  });

  it("is harmless for a user without passkeys", async () => {
    await seed("alice", []);
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

describe("dsh-auth passkey dispatch", () => {
  it("prints usage for an unknown subcommand", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "frobnicate", "alice", {}, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
  });
});
