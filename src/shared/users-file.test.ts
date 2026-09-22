import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareNames,
  defaultUsersFilePath,
  loadUsersFile,
  renameWithRetry,
  UsersFileError,
  writeUsersFile,
  type UsersSnapshot,
} from "./users-file.js";

const VALID_YAML = `version: 1
users:
  alice:
    passwordHash: scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k
    totpSecret: BASE32SECRET
    disabled: true
  bob:
    passwordHash: scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k
`;

describe("defaultUsersFilePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses DSH_HOME when set", () => {
    vi.stubEnv("DSH_HOME", "/srv/dsh");
    expect(defaultUsersFilePath()).toBe(path.join("/srv/dsh", "auth", "users.yaml"));
  });

  it("falls back to ~/.dsh when DSH_HOME is unset", () => {
    vi.stubEnv("DSH_HOME", undefined);
    expect(defaultUsersFilePath()).toBe(path.join(os.homedir(), ".dsh", "auth", "users.yaml"));
  });
});

describe("loadUsersFile", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-users-"));
    file = path.join(dir, "users.yaml");
    await fs.writeFile(file, VALID_YAML, { mode: 0o600 });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("loads a valid file with defaults applied", async () => {
    const { snapshot, missing } = await loadUsersFile(file);
    expect(missing).toBe(false);
    expect([...snapshot.users.keys()].sort(compareNames)).toEqual(["alice", "bob"]);
    const alice = snapshot.users.get("alice");
    expect(alice?.passwordHash).toMatch(/^scrypt\$/);
    expect(alice?.totpSecret).toBe("BASE32SECRET");
    expect(alice?.disabled).toBe(true);
    expect(snapshot.users.get("bob")?.disabled).toBe(false);
    expect(snapshot.users.get("bob")?.totpSecret).toBeUndefined();
  });

  it("reports missing:true when the file does not exist", async () => {
    const { snapshot, missing } = await loadUsersFile(path.join(dir, "nope.yaml"));
    expect(missing).toBe(true);
    expect(snapshot.users.size).toBe(0);
  });

  it("throws UsersFileError on YAML syntax errors", async () => {
    await fs.writeFile(file, "version: 1\nusers: [unclosed");
    await expect(loadUsersFile(file)).rejects.toBeInstanceOf(UsersFileError);
  });

  it("throws UsersFileError on duplicate keys", async () => {
    await fs.writeFile(
      file,
      "version: 1\nusers:\n  alice:\n    passwordHash: a\n  alice:\n    passwordHash: b\n",
    );
    await expect(loadUsersFile(file)).rejects.toBeInstanceOf(UsersFileError);
  });

  it("throws UsersFileError on schema violations", async () => {
    const cases = [
      "version: 2\nusers: {}\n",
      "version: 1\nunknown: 1\nusers: {}\n",
      "version: 1\nusers:\n  alice:\n    unknownField: x\n",
      "version: 1\nusers:\n  alice:\n    disabled: true\n", // 缺 passwordHash
      "version: 1\nusers:\n  bad name!:\n    passwordHash: a\n",
      "version: 1\nusers:\n  alice:\n    totpSecret: 42\n    passwordHash: a\n",
    ];
    for (const text of cases) {
      await fs.writeFile(file, text);
      await expect(loadUsersFile(file)).rejects.toBeInstanceOf(UsersFileError);
    }
  });

  it(
    "throws UsersFileError when group/other can read the file (POSIX only)",
    { skip: process.platform === "win32" },
    async () => {
      await fs.chmod(file, 0o644);
      await expect(loadUsersFile(file)).rejects.toBeInstanceOf(UsersFileError);
    },
  );
});

describe("writeUsersFile", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-users-"));
    file = path.join(dir, "sub", "users.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes deterministic content with sorted users and no tmp residue", async () => {
    const snapshot: UsersSnapshot = {
      users: new Map([
        ["bob", { passwordHash: "h1", disabled: false }],
        ["alice", { passwordHash: "h2", totpSecret: "S3", disabled: true }],
      ]),
    };
    await writeUsersFile(file, snapshot);
    const text = await fs.readFile(file, "utf8");
    expect(text).toBe(`version: 1
users:
  alice:
    passwordHash: h2
    totpSecret: S3
    disabled: true
  bob:
    passwordHash: h1
`);
    await expect(fs.stat(`${file}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates parent directories automatically", async () => {
    await writeUsersFile(file, { users: new Map() });
    await expect(fs.readFile(file, "utf8")).resolves.toContain("version: 1");
  });

  it("writes with mode 0600 (POSIX only)", { skip: process.platform === "win32" }, async () => {
    await writeUsersFile(file, { users: new Map() });
    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("renameWithRetry", () => {
  /** 构造带 errno code 的错误（与 node 的 rename 失败形状一致）。 */
  function failure(code: string): Error {
    return Object.assign(new Error(code), { code });
  }

  it("retries while the target handle is transiently busy", async () => {
    let calls = 0;
    const flaky = (): Promise<void> => {
      calls += 1;
      return calls < 3 ? Promise.reject(failure("EPERM")) : Promise.resolve();
    };
    await expect(renameWithRetry("a", "b", flaky)).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  it("gives up after the attempt budget and rethrows the last error", async () => {
    let calls = 0;
    const alwaysBusy = (): Promise<void> => {
      calls += 1;
      return Promise.reject(failure("EBUSY"));
    };
    await expect(renameWithRetry("a", "b", alwaysBusy)).rejects.toThrow("EBUSY");
    expect(calls).toBe(5);
  });

  it("rethrows a non-transient failure without retrying", async () => {
    let calls = 0;
    const missing = (): Promise<void> => {
      calls += 1;
      return Promise.reject(failure("ENOENT"));
    };
    await expect(renameWithRetry("a", "b", missing)).rejects.toThrow("ENOENT");
    expect(calls).toBe(1);
  });
});
