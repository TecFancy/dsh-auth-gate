import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareNames,
  loadUsersFile,
  mutateUsersFile,
  UsersFileError,
  writeUsersFile,
  type UserRecord,
  type UsersSnapshot,
} from "./users-file.js";

/** 记录工厂：默认值与读盘缺省一致（role user / mustChangePassword false）。 */
function record(passwordHash: string, extra: Partial<UserRecord> = {}): UserRecord {
  return { passwordHash, disabled: false, role: "user", mustChangePassword: false, ...extra };
}

/** 写锁文件并把 mtime 倒回 ageMs 毫秒前（pid 死活由调用方决定）。 */
async function writeLock(file: string, pid: number, ageMs: number): Promise<void> {
  const owner = { pid, host: os.hostname(), token: "test-token", startedAt: 1 };
  await fs.writeFile(`${file}.lock`, JSON.stringify(owner), { mode: 0o600 });
  const when = new Date(Date.now() - ageMs);
  await fs.utimes(`${file}.lock`, when, when);
}

/** 断言文件不存在。 */
async function expectMissing(target: string): Promise<void> {
  await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
}

let dir = "";
let file = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-mutate-"));
  file = path.join(dir, "users.yaml");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** 建好只有 seed 一个用户的 users.yaml。 */
function seed(): Promise<void> {
  return writeUsersFile(file, { users: new Map([["seed", record("h0")]]) });
}

/** 锁内加一个用户；options 供锁超时/陈旧/CAS 场景。 */
function add(
  name: string,
  options?: { timeoutMs?: number; staleMs?: number; attempts?: number },
): Promise<void> {
  const mutator = (snapshot: UsersSnapshot): void => {
    snapshot.users.set(name, record(`h-${name}`));
  };
  return mutateUsersFile(file, mutator, options);
}

/** 读回用户名（字典序）。 */
async function names(): Promise<string[]> {
  const { snapshot } = await loadUsersFile(file);
  return [...snapshot.users.keys()].sort(compareNames);
}

describe("mutateUsersFile basics", () => {
  it("creates a missing file, returns the mutator result and leaves no lock", async () => {
    const result = await mutateUsersFile(file, (snapshot) => {
      snapshot.users.set("alice", record("h1"));
      return "done";
    });
    expect(result).toBe("done");
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.passwordHash).toBe("h1");
    await expectMissing(`${file}.lock`);
    await expectMissing(`${file}.bak`);
  });

  it("awaits an async mutator and writes atomically without residue", async () => {
    await seed();
    await mutateUsersFile(file, async (snapshot) => {
      await Promise.resolve();
      snapshot.users.set("added", record("h-1", { role: "admin", mustChangePassword: true }));
    });
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("    role: admin\n");
    expect(text).toContain("    must_change_password: true\n");
    await expectMissing(`${file}.tmp`);
    await expectMissing(`${file}.lock`);
  });

  it("propagates mutator errors unchanged and leaves no lock", async () => {
    await seed();
    const before = await fs.readFile(file, "utf8");
    const boom = new UsersFileError("boom");
    const thrower = (): never => {
      throw boom;
    };
    await expect(mutateUsersFile(file, thrower)).rejects.toBe(boom);
    await expectMissing(`${file}.lock`);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("does not persist default role / mustChangePassword on a legacy file", async () => {
    await seed();
    await add("added");
    const text = await fs.readFile(file, "utf8");
    expect(text).toBe(`version: 1
users:
  added:
    passwordHash: h-added
  seed:
    passwordHash: h0
`);
  });
});

describe("mutateUsersFile last-admin invariant", () => {
  it("refuses to remove or demote the last active admin and leaves no residue", async () => {
    await writeUsersFile(file, { users: new Map([["root", record("h0", { role: "admin" })]]) });
    const before = await fs.readFile(file, "utf8");
    const disable = (snapshot: UsersSnapshot): void => {
      snapshot.users.get("root")!.disabled = true;
    };
    const demote = (snapshot: UsersSnapshot): void => {
      snapshot.users.get("root")!.role = "user";
    };
    await expect(mutateUsersFile(file, disable)).rejects.toThrow("cannot remove the last admin");
    await expect(mutateUsersFile(file, demote)).rejects.toThrow("cannot remove the last admin");
    await expectMissing(`${file}.lock`);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("treats a disabled admin as inactive, not as a fallback admin", async () => {
    await writeUsersFile(file, {
      users: new Map([
        ["root", record("h0", { role: "admin", disabled: true })],
        ["other", record("h1", { role: "admin" })],
      ]),
    });
    const disableOther = (snapshot: UsersSnapshot): void => {
      snapshot.users.get("other")!.disabled = true;
    };
    await expect(mutateUsersFile(file, disableOther)).rejects.toThrow(
      "cannot remove the last admin",
    );
  });

  it("allows disabling one of two active admins", async () => {
    await writeUsersFile(file, {
      users: new Map([
        ["root", record("h0", { role: "admin" })],
        ["second", record("h1", { role: "admin" })],
      ]),
    });
    await mutateUsersFile(file, (snapshot) => {
      snapshot.users.get("root")!.disabled = true;
    });
    expect((await loadUsersFile(file)).snapshot.users.get("root")?.disabled).toBe(true);
  });
});

describe("mutateUsersFile locking", () => {
  it("serializes same-process mutations without losing updates", async () => {
    await seed();
    const originalRename = fs.rename.bind(fs);
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atRename = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      reached();
      await gate;
      await originalRename(from, to);
    });
    let secondRan = false;
    const first = add("first");
    await atRename;
    const second = mutateUsersFile(file, (snapshot) => {
      secondRan = true;
      snapshot.users.set("second", record("h2"));
    });
    // 第一个仍持锁（卡在写前 rename）：第二个必须还在等锁，mutator 不得进入。
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondRan).toBe(false);
    await expect(fs.stat(`${file}.lock`)).resolves.toBeDefined();
    release();
    await Promise.all([first, second]);
    expect(await names()).toEqual(["first", "second", "seed"]);
    await expectMissing(`${file}.lock`);
  });

  it("times out while a live pid holds a fresh lock and keeps that lock", async () => {
    await seed();
    await writeLock(file, process.pid, 0);
    await expect(mutateUsersFile(file, () => undefined, { timeoutMs: 150 })).rejects.toThrow(
      "users file is locked by another process",
    );
    await expect(fs.stat(`${file}.lock`)).resolves.toBeDefined();
  });

  it("does not delete a lock taken over by another owner (compare-and-unlink)", async () => {
    await seed();
    const takeover = JSON.stringify({ pid: 1, host: "other", token: "new-owner", startedAt: 1 });
    const result = await mutateUsersFile(file, async (snapshot) => {
      snapshot.users.set("first", record("h1"));
      // 模拟外部判 stale 夺锁：本进程的 token 已被新持有者替换。
      await fs.writeFile(`${file}.lock`, takeover, { mode: 0o600 });
      return "done";
    });
    expect(result).toBe("done");
    expect(await fs.readFile(`${file}.lock`, "utf8")).toBe(takeover);
  });

  it("steals stale locks: old mtime, unreadable payload or 0 bytes", async () => {
    await seed();
    await writeLock(file, process.pid, 5_000);
    await add("afterMtime", { staleMs: 100 });
    await fs.writeFile(`${file}.lock`, "not json", { mode: 0o600 });
    await add("afterGarbage", { timeoutMs: 500 });
    await fs.writeFile(`${file}.lock`, "", { mode: 0o600 });
    await add("afterEmpty", { timeoutMs: 500 });
    expect(await names()).toEqual(["afterEmpty", "afterGarbage", "afterMtime", "seed"]);
  });

  it("steals a fresh lock left behind by a dead pid", async () => {
    await seed();
    const { pid } = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
    await writeLock(file, pid ?? 0, 0);
    await add("after", { timeoutMs: 500 });
    expect(await names()).toEqual(["after", "seed"]);
  });
});

describe("mutateUsersFile CAS", () => {
  it("re-reads and re-runs the mutator, seeing the latest snapshot", async () => {
    await seed();
    const seen: string[] = [];
    const result = await mutateUsersFile(file, async (snapshot) => {
      seen.push([...snapshot.users.keys()].sort(compareNames).join(","));
      if (seen.length === 1) {
        await writeUsersFile(file, {
          users: new Map([
            ["ghost", record("g0x")],
            ["seed", record("h0")],
          ]),
        });
      }
      snapshot.users.set("added", record("h1"));
      return seen.length;
    });
    expect(result).toBe(2);
    expect(seen).toEqual(["seed", "ghost,seed"]); // 第二次跑拿的是外部写入后的最新快照
    expect(await names()).toEqual(["added", "ghost", "seed"]);
    await expectMissing(`${file}.lock`);
  });

  it("gives up after the attempt budget when the file keeps changing", async () => {
    await seed();
    let runs = 0;
    const churn = async (snapshot: UsersSnapshot): Promise<void> => {
      runs += 1;
      await writeUsersFile(file, {
        users: new Map([[`churn${String(runs)}`, record("c".repeat(runs + 2))]]),
      });
      snapshot.users.set("added", record("h1"));
    };
    await expect(mutateUsersFile(file, churn, { attempts: 2 })).rejects.toThrow(
      "users file changed while it was locked; giving up",
    );
    expect(runs).toBe(2);
    await expectMissing(`${file}.lock`);
  });
});
