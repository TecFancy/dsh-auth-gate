import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareNames,
  loadUsersFile,
  mutateUsersFile,
  writeUsersFile,
} from "../../shared/index.js";
import type { UsersSnapshot } from "../../shared/index.js";
import type { AdminDeps } from "./deps.js";
import { handleResetPassword } from "./endpoints.js";
import {
  form,
  makeHarness,
  makeReq,
  makeRes,
  type FakeRes,
  type ReqOptions,
} from "./test-harness.js";

/**
 * grok #5（TOCTOU）：授权读在锁外（`adminActor`），写盘在锁内。
 * 这里用**真实文件 + 真实锁**注入「授权通过后、写盘前被降权」的窗口。
 */
const NEW_PASSWORD = "NewPassw0rd!XY";
const SAME_ORIGIN = { secFetchSite: "same-origin" };
const FIELDS = [
  "actor",
  "clientIp",
  "event",
  "ok",
  "reason",
  "reauth",
  "sessionsRevoked",
  "target",
  "targetDisabled",
  "ts",
];

async function seed(usersPath: string): Promise<void> {
  await writeUsersFile(usersPath, {
    users: new Map([
      ["admin", { passwordHash: "hash-admin", disabled: false, role: "admin" }],
      // 第二个 admin：让「降权/禁用 actor」不触发 store 的 last-admin 不变量
      // （真实运维里 CLI 也降不了最后一个 admin，所以窗口必须建立在还有别的 admin 时）。
      ["admin2", { passwordHash: "hash-admin2", disabled: false, role: "admin" }],
      ["alice", { passwordHash: "hash-alice", disabled: false, role: "user" }],
    ]),
  });
}

/** 真文件 + 真锁；`demote` = 在端点 mutator 之前先把 actor 降权（模拟锁外窗口里的 CLI 操作）。 */
function demotingDeps(usersPath: string, demote: boolean): Partial<AdminDeps> {
  return {
    loadUsers: async () => (await loadUsersFile(usersPath)).snapshot,
    mutateUsers: async (mutator: (snapshot: UsersSnapshot) => void | Promise<void>) => {
      if (demote) {
        await mutateUsersFile(usersPath, (snapshot) => {
          const actor = snapshot.users.get("admin");
          if (actor !== undefined) actor.role = "user";
        });
      }
      await mutateUsersFile(usersPath, mutator);
    },
  };
}

async function post(deps: AdminDeps, options: ReqOptions = {}): Promise<FakeRes> {
  const res = makeRes();
  const body = form({ target: "alice", password: NEW_PASSWORD });
  await handleResetPassword(deps, makeReq({ body, ...options }), res.res);
  return res;
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort((a, b) => compareNames(a, b));
}

describe("TOCTOU：锁内复核 actor（grok #5）", () => {
  it("授权后被降权 → 403 forbidden，target 哈希未写、目标会话未吊销、不计失败", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-admin-toctou-"));
    const usersPath = join(root, "users.yaml");
    try {
      await seed(usersPath);
      const harness = makeHarness(demotingDeps(usersPath, true));
      const res = await post(harness.deps, SAME_ORIGIN);
      expect(res.status).toBe(403);
      expect(res.body).toBe(JSON.stringify({ error: "forbidden" }));
      const events = harness.audits();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: "audit.user.password_reset.denied",
        reason: "forbidden",
        ok: false,
      });
      expect(sortedKeys(events[0] ?? {})).toEqual(FIELDS); // 形状不变：仍 10 键
      // 磁盘：target 一字未动
      const loaded = await loadUsersFile(usersPath);
      expect(loaded.snapshot.users.get("alice")?.passwordHash).toBe("hash-alice");
      expect(loaded.snapshot.users.get("alice")?.mustChangePassword).toBeFalsy();
      // 会话：目标仍可用
      expect(harness.revokes).toEqual([]);
      expect(harness.store.getByToken("alice")).toBeDefined();
      // 授权变更不计失败（连续多次也不会把 actor 锁死）
      for (let attempt = 0; attempt < 6; attempt += 1) {
        expect((await post(harness.deps, SAME_ORIGIN)).status).toBe(403);
      }
      expect(harness.limiter.check("127.0.0.1", "admin").allowed).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("对照组：actor 仍是 admin → 200，写盘发生", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-admin-toctou-ok-"));
    const usersPath = join(root, "users.yaml");
    try {
      await seed(usersPath);
      const harness = makeHarness(demotingDeps(usersPath, false));
      const res = await post(harness.deps, SAME_ORIGIN);
      expect(res.status).toBe(200);
      expect(res.body).toBe(JSON.stringify({ ok: true, sessionsRevoked: true }));
      const loaded = await loadUsersFile(usersPath);
      expect(loaded.snapshot.users.get("alice")?.passwordHash).toBe("scrypt$stub$14");
      expect(loaded.snapshot.users.get("alice")?.mustChangePassword).toBe(true);
      expect(harness.revokes).toEqual(["alice"]);
      expect(harness.audits()[0]?.event).toBe("audit.user.password_reset");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("actor 被禁用（disabled=true）同样在锁内被拦下", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-admin-toctou-dis-"));
    const usersPath = join(root, "users.yaml");
    try {
      await seed(usersPath);
      const harness = makeHarness({
        loadUsers: async () => (await loadUsersFile(usersPath)).snapshot,
        mutateUsers: async (mutator) => {
          await mutateUsersFile(usersPath, (snapshot) => {
            const actor = snapshot.users.get("admin");
            if (actor !== undefined) actor.disabled = true;
          });
          await mutateUsersFile(usersPath, mutator);
        },
      });
      const res = await post(harness.deps, SAME_ORIGIN);
      expect(res.status).toBe(403);
      expect((await loadUsersFile(usersPath)).snapshot.users.get("alice")?.passwordHash).toBe(
        "hash-alice",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
