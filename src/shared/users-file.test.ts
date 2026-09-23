import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareNames,
  defaultUsersFilePath,
  loadUsersFile,
  mutateUsersFile,
  renameWithRetry,
  UsersFileError,
  writeUsersFile,
  type UserRecord,
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

/** 最小记录：默认值显式写全（role user / mustChangePassword false）。 */
function user(passwordHash: string): UserRecord {
  return { passwordHash, disabled: false, role: "user", mustChangePassword: false };
}

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

describe("loadUsersFile", () => {
  it("loads a valid file with defaults applied", async () => {
    const { snapshot, missing } = await loadUsersFile(file);
    expect(missing).toBe(false);
    expect([...snapshot.users.keys()].sort(compareNames)).toEqual(["alice", "bob"]);
    expect(snapshot.users.get("alice")?.totpSecret).toBe("BASE32SECRET");
    expect(snapshot.users.get("alice")?.disabled).toBe(true);
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
      "version: 1\nusers:\n  alice:\n    passwordHash: a\n    role: 7\n",
      "version: 1\nusers:\n  alice:\n    passwordHash: a\n    role: root\n",
      "version: 1\nusers:\n  alice:\n    passwordHash: a\n    must_change_password: nope\n",
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

describe("loadUsersFile role / must_change_password", () => {
  it("defaults role to user and mustChangePassword to false", async () => {
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.role).toBe("user");
    expect(snapshot.users.get("alice")?.mustChangePassword).toBe(false);
    expect(snapshot.users.get("bob")?.role).toBe("user");
    expect(snapshot.users.get("bob")?.mustChangePassword).toBe(false);
  });

  it("reads role and must_change_password when present", async () => {
    await fs.writeFile(
      file,
      `version: 1
users:
  alice:
    passwordHash: a
    role: admin
    must_change_password: true
`,
    );
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.role).toBe("admin");
    expect(snapshot.users.get("alice")?.mustChangePassword).toBe(true);
  });
});

describe("writeUsersFile", () => {
  beforeEach(() => {
    file = path.join(dir, "sub", "users.yaml");
  });

  it("writes deterministic content with sorted users and no tmp residue", async () => {
    const snapshot: UsersSnapshot = {
      users: new Map([
        ["bob", user("h1")],
        ["alice", { ...user("h2"), totpSecret: "S3", disabled: true }],
      ]),
    };
    await writeUsersFile(file, snapshot);
    expect(await fs.readFile(file, "utf8")).toBe(`version: 1
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

  it(
    "creates parent directories automatically and writes with mode 0600",
    { skip: process.platform === "win32" },
    async () => {
      await writeUsersFile(file, { users: new Map() });
      await expect(fs.readFile(file, "utf8")).resolves.toContain("version: 1");
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    },
  );
});

describe("writeUsersFile role / mustChangePassword", () => {
  beforeEach(() => {
    file = path.join(dir, "sub", "users.yaml");
  });

  it("persists admin and must_change_password, leaving defaults unwritten", async () => {
    await writeUsersFile(file, {
      users: new Map([["alice", { ...user("h2"), role: "admin", mustChangePassword: true }]]),
    });
    expect(await fs.readFile(file, "utf8")).toBe(`version: 1
users:
  alice:
    passwordHash: h2
    role: admin
    must_change_password: true
`);
  });

  it("round-trips the legacy fixture without changing its bytes", async () => {
    const legacy = path.join(dir, "legacy.yaml");
    await fs.writeFile(legacy, VALID_YAML, { mode: 0o600 });
    const { snapshot } = await loadUsersFile(legacy);
    await writeUsersFile(file, snapshot);
    expect(await fs.readFile(file, "utf8")).toBe(VALID_YAML);
  });
});

describe("mutateUsersFile backup", () => {
  it(
    "rolls a single 0600 .bak holding the previous bytes",
    { skip: process.platform === "win32" },
    async () => {
      await mutateUsersFile(file, (snapshot) => {
        snapshot.users.set("carol", user("h3"));
      });
      expect(await fs.readFile(`${file}.bak`, "utf8")).toBe(VALID_YAML);
      expect((await fs.stat(`${file}.bak`)).mode & 0o777).toBe(0o600);
      const afterFirst = await fs.readFile(file, "utf8");
      await mutateUsersFile(file, (snapshot) => {
        snapshot.users.set("dave", user("h4"));
      });
      expect(await fs.readFile(`${file}.bak`, "utf8")).toBe(afterFirst);
    },
  );

  it("still writes when the backup cannot be created", async () => {
    await fs.mkdir(`${file}.bak`);
    await mutateUsersFile(file, (snapshot) => {
      snapshot.users.set("carol", user("h3"));
    });
    expect((await loadUsersFile(file)).snapshot.users.has("carol")).toBe(true);
  });

  it("reports a UsersFileError when the users directory cannot be created", async () => {
    const blocker = path.join(dir, "blocker");
    await fs.writeFile(blocker, "x");
    const target = path.join(blocker, "users.yaml");
    await expect(mutateUsersFile(target, () => undefined)).rejects.toBeInstanceOf(UsersFileError);
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
