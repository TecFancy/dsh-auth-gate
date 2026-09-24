import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadUsersFile, mutateUsersFile, writeUsersFile } from "../../shared/index.js";
import type { AdminDeps } from "./deps.js";
import { handleResetPassword } from "./endpoints.js";
import {
  adminUser,
  form,
  makeHarness,
  makeReq,
  makeRes,
  type FakeRes,
  type ReqOptions,
} from "./test-harness.js";

const TARGET = "alice";
const SAME_ORIGIN = { secFetchSite: "same-origin" };

function realFileDeps(usersPath: string): Partial<AdminDeps> {
  return {
    loadUsers: async () => (await loadUsersFile(usersPath)).snapshot,
    mutateUsers: (mutator) => mutateUsersFile(usersPath, mutator),
  };
}

async function seed(usersPath: string): Promise<void> {
  await writeUsersFile(usersPath, {
    users: new Map([
      ["admin", { passwordHash: "hash-admin", disabled: false, role: "admin" }],
      [TARGET, { passwordHash: "hash-alice", disabled: false, role: "user" }],
      ["bob", { passwordHash: "hash-bob", disabled: false, role: "user" }],
    ]),
  });
}

async function post(deps: AdminDeps, body: string, options: ReqOptions = {}): Promise<FakeRes> {
  const res = makeRes();
  await handleResetPassword(deps, makeReq({ body, ...options }), res.res);
  return res;
}

function resetBody(password: string): string {
  return form({ target: TARGET, password });
}

describe("真实 mutateUsersFile 并发（验收 16）", () => {
  it("两个 admin 同时重置同一目标：都 200、文件一致、不留锁", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-admin-conc-"));
    const usersPath = join(root, "users.yaml");
    try {
      await seed(usersPath);
      const harness = makeHarness(realFileDeps(usersPath));
      const [first, second] = await Promise.all([
        post(harness.deps, resetBody("NewPassw0rd!X1"), SAME_ORIGIN),
        post(harness.deps, resetBody("NewPassw0rd!X2"), SAME_ORIGIN),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);
      const loaded = await loadUsersFile(usersPath);
      expect(loaded.snapshot.users.get(TARGET)?.mustChangePassword).toBe(true);
      expect(loaded.snapshot.users.get(TARGET)?.role).toBe("user");
      expect(loaded.snapshot.users.get("admin")?.role).toBe("admin");
      expect(() => statSync(`${usersPath}.lock`)).toThrow(); // 失败不得留锁
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("HTTP 重置与 CLI 风格写并发：CAS 重跑不丢更新", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-admin-cli-"));
    const usersPath = join(root, "users.yaml");
    try {
      await seed(usersPath);
      const harness = makeHarness(realFileDeps(usersPath));
      const [reset, role] = await Promise.all([
        post(harness.deps, resetBody("NewPassw0rd!X3"), SAME_ORIGIN),
        mutateUsersFile(usersPath, (snapshot) => {
          const bob = snapshot.users.get("bob");
          if (bob !== undefined) bob.role = "admin";
        }),
      ]);
      expect(reset.status).toBe(200);
      expect(role).toBeUndefined();
      const loaded = await loadUsersFile(usersPath);
      expect(loaded.snapshot.users.get("bob")?.role).toBe("admin"); // CLI 改动保留
      expect(loaded.snapshot.users.get(TARGET)?.mustChangePassword).toBe(true); // HTTP 改动保留
      expect(loaded.snapshot.users.get(TARGET)?.passwordHash).toMatch(/^scrypt\$stub\$\d+$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("写后文件仍 0600，last-admin 不变量未被误触发", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-admin-mode-"));
    const usersPath = join(root, "users.yaml");
    try {
      await seed(usersPath);
      const harness = makeHarness(realFileDeps(usersPath));
      expect((await post(harness.deps, resetBody("NewPassw0rd!X4"), SAME_ORIGIN)).status).toBe(200);
      // Windows 没有 POSIX 权限位（Node 恒报 0o666）：与 shared/users-file.test.ts 同口径跳过本断言。
      if (process.platform !== "win32") {
        expect(statSync(usersPath).mode & 0o777).toBe(0o600);
      }
      const loaded = await loadUsersFile(usersPath);
      const admins = [...loaded.snapshot.users.values()].filter(
        (record) => record.role === "admin" && !record.disabled,
      );
      expect(admins).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("锁内快照里目标已消失 → 503（不静默写幽灵用户）", async () => {
    const harness = makeHarness({
      // 锁内快照只保留 actor（否则先撞 TOCTOU 的 actor 复核，走 403 而非本用例的 io 路径）
      mutateUsers: async (mutator) => {
        await mutator({ users: new Map([["admin", adminUser()]]) });
      },
    });
    const res = await post(harness.deps, resetBody("NewPassw0rd!X5"), SAME_ORIGIN);
    expect(res.status).toBe(503);
    expect(harness.audits()[0]?.reason).toBe("io");
    expect(harness.revokes).toEqual([]);
  });
});
