import { describe, expect, it } from "vitest";
import { handleResetPassword } from "./endpoints.js";
import {
  form,
  makeHarness,
  makeReq,
  makeRes,
  type Harness,
  type ReqOptions,
} from "./test-harness.js";

const NEW_PASSWORD = "NewPassw0rd!XY";
const SAME_ORIGIN = { secFetchSite: "same-origin" };

async function post(
  harness: Harness,
  options: ReqOptions = {},
): Promise<ReturnType<typeof makeRes>> {
  const res = makeRes();
  const body = options.body ?? form({ target: "alice", password: NEW_PASSWORD });
  await handleResetPassword(harness.deps, makeReq({ body, ...options }), res.res);
  return res;
}

describe("重置成功：写盘语义（验收 8）", () => {
  it("设 must_change_password + 新哈希，totpSecret/role/disabled 字节不动", async () => {
    const harness = makeHarness();
    harness.users.set("bob", {
      passwordHash: "hash-bob",
      totpSecret: "BOB-SECRET",
      disabled: true,
      role: "admin",
    });
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "bob", password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true, sessionsRevoked: true }));
    const bob = harness.users.get("bob");
    expect(bob?.passwordHash).toBe(`scrypt$stub$${NEW_PASSWORD.length}`);
    expect(bob?.mustChangePassword).toBe(true);
    expect(bob?.totpSecret).toBe("BOB-SECRET");
    expect(bob?.role).toBe("admin");
    expect(bob?.disabled).toBe(true);
  });

  it("响应头 no-store + pragma + json；成功只发一条审计", async () => {
    const harness = makeHarness();
    const res = await post(harness, { ...SAME_ORIGIN });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["content-type"]).toBe("application/json");
    expect(harness.audits()).toHaveLength(1);
    expect(harness.audits()[0]?.event).toBe("audit.user.password_reset");
  });

  it("不需要 current 字段（管理重置不是自助改密）", async () => {
    const harness = makeHarness();
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "alice", password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
  });
});

describe("会话吊销与清桶（验收 9/10）", () => {
  it("目标全部会话失效（含其他设备），actor 自己仍在", async () => {
    const harness = makeHarness();
    const other = await harness.store.create("alice", 600_000);
    expect(harness.store.getByToken(other.token)).toBeDefined();
    const res = await post(harness, { ...SAME_ORIGIN });
    expect(res.status).toBe(200);
    expect(harness.store.getByToken(other.token)).toBeUndefined();
    expect(harness.store.getByToken("alice")).toBeUndefined();
    expect(harness.store.getByToken("admin")).toBeDefined();
    expect(harness.revokes).toEqual(["alice"]);
  });

  it("成功时清目标限流桶（登录桶 + 自助改密桶由注入方处理）", async () => {
    const harness = makeHarness();
    await post(harness, { ...SAME_ORIGIN });
    expect(harness.cleared).toEqual(["alice"]);
  });

  it("revoke 失败（false）：仍 200 + sessionsRevoked:false + 仍清桶", async () => {
    const harness = makeHarness({
      revokeSubject: () => Promise.resolve(false),
    });
    const res = await post(harness, { ...SAME_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true, sessionsRevoked: false }));
    expect(harness.cleared).toEqual(["alice"]);
    expect(harness.users.get("alice")?.passwordHash).toBe(`scrypt$stub$${NEW_PASSWORD.length}`);
  });

  it("revoke 抛错也被兜住：200 + 恰好一条成功事件 + 口令确已变更、可用新口令登录", async () => {
    const harness = makeHarness({
      // 可验证的哈希对：断言写盘后的口令确实能通过校验（= 目标此刻可用新口令登录）。
      hash: (password) => Promise.resolve(`hash:${password}`),
      verify: (password, stored) => Promise.resolve(stored === `hash:${password}`),
      revokeSubject: () => Promise.reject(new Error("store down")),
    });
    const res = await post(harness, { ...SAME_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true, sessionsRevoked: false }));
    const events = harness.audits();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "audit.user.password_reset",
      ok: true,
      sessionsRevoked: false,
    });
    expect(harness.logs[0]?.level).toBe("error");
    const stored = harness.users.get("alice")?.passwordHash ?? "";
    expect(stored).toBe(`hash:${NEW_PASSWORD}`);
    await expect(harness.deps.verify(NEW_PASSWORD, stored)).resolves.toBe(true);
    expect(harness.cleared).toEqual(["alice"]);
  });

  it("revoke 返回 false（不抛）：同样 200 + 成功事件 + 旧口令失效", async () => {
    const harness = makeHarness({
      hash: (password) => Promise.resolve(`hash:${password}`),
      verify: (password, stored) => Promise.resolve(stored === `hash:${password}`),
      revokeSubject: () => Promise.resolve(false),
    });
    const res = await post(harness, { ...SAME_ORIGIN });
    expect(res.status).toBe(200);
    expect(harness.audits()).toHaveLength(1);
    const stored = harness.users.get("alice")?.passwordHash ?? "";
    await expect(harness.deps.verify(NEW_PASSWORD, stored)).resolves.toBe(true);
    await expect(harness.deps.verify("old-alice-pw", stored)).resolves.toBe(false);
  });
});

describe("target === actor（验收 7）", () => {
  it("admin 重置自己 → 403 且不写盘、不吊销、不消费 TOTP 窗口", async () => {
    const harness = makeHarness();
    harness.users.set("totpadmin2", {
      passwordHash: "h2",
      disabled: false,
      role: "admin",
      totpSecret: "S",
    });
    const issued = await harness.store.create("totpadmin2", 600_000);
    const res = await post(harness, {
      secFetchSite: "same-origin",
      body: form({ target: "totpadmin2", password: NEW_PASSWORD, code: "123456" }),
      cookie: `dsh_auth=${issued.token}`,
    });
    expect(res.status).toBe(403);
    expect(harness.hashCalls).toEqual([]);
    expect(harness.revokes).toEqual([]);
    expect(harness.totpCalls).toEqual([]); // TOTP 在 self 之后，窗口未被消费
    expect(harness.users.get("totpadmin2")?.passwordHash).toBe("h2");
  });
});

describe("目标不存在 / targetDisabled（验收 11）", () => {
  it("目标不存在 → 404 且不写盘", async () => {
    const harness = makeHarness();
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "ghost", password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(404);
    expect(res.body).toBe(JSON.stringify({ error: "not_found" }));
    expect(harness.hashCalls).toEqual([]);
    expect(harness.revokes).toEqual([]);
  });

  it("disabled 目标 → 200：仍设标记、仍踢会话，审计 targetDisabled:true", async () => {
    const harness = makeHarness();
    harness.users.set("oldbob", { passwordHash: "hb", disabled: true, role: "user" });
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "oldbob", password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(harness.users.get("oldbob")?.mustChangePassword).toBe(true);
    expect(harness.revokes).toEqual(["oldbob"]);
    expect(harness.audits()[0]?.targetDisabled).toBe(true);
  });
});
