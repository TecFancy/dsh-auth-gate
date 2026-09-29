import { describe, expect, it, vi } from "vitest";
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

describe("策略复用（验收 12）", () => {
  it("弱口令 → 400 + rules，未哈希未写盘未吊销", async () => {
    const harness = makeHarness();
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "alice", password: "short" }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "policy",
      rules: ["minLength", "uppercase", "digit", "special"],
    });
    expect(harness.hashCalls).toEqual([]);
    expect(harness.revokes).toEqual([]);
  });

  it("超过 256 字符 → 400 maxLength（与自助面同模块）", async () => {
    const harness = makeHarness();
    const long = `Aa1!${"x".repeat(260)}`;
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "alice", password: long }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ rules: ["maxLength"] });
  });

  it("新口令等于目标旧口令 → 400 sameAsOld（用现哈希验一次）", async () => {
    const harness = makeHarness({
      verify: (password, hash) =>
        Promise.resolve(hash === "hash-alice" && password === NEW_PASSWORD),
    });
    const res = await post(harness, { ...SAME_ORIGIN });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "policy", rules: ["sameAsOld"] });
  });

  it("策略在 TOTP 之前：口令不合规不消费验证码", async () => {
    const harness = makeHarness();
    const res = await post(harness, {
      ...SAME_ORIGIN,
      cookie: "dsh_auth=totpadmin",
      body: form({ target: "alice", password: "short", code: "123456" }),
    });
    expect(res.status).toBe(400);
    expect(harness.totpCalls).toEqual([]);
  });
});

describe("口令原样透传：不 trim、不 NFKC（F7 / 验收 12）", () => {
  it("尾随空格原样进 hash，也原样进 sameAsOld 比较", async () => {
    const verify = vi.fn(() => Promise.resolve(false));
    const harness = makeHarness({ verify });
    const spaced = `${NEW_PASSWORD} `;
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "alice", password: spaced }),
    });
    expect(res.status).toBe(200);
    expect(harness.hashCalls).toEqual([spaced]);
    expect(verify).toHaveBeenCalledWith(spaced, "hash-alice");
  });

  it("仅 NFKC 归一化差异的口令不被规范化", async () => {
    const harness = makeHarness();
    const fullWidth = "NewPassw0rd!ＸY"; // U+FF38 全角 X
    expect(fullWidth.normalize("NFKC")).not.toBe(fullWidth);
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "alice", password: fullWidth }),
    });
    expect(res.status).toBe(200);
    expect(harness.hashCalls).toEqual([fullWidth]);
    expect(harness.hashCalls[0]).not.toBe(fullWidth.normalize("NFKC"));
  });
});

describe("条件式 TOTP（验收 13）", () => {
  it("actor 未启用 TOTP：不带 code 成功", async () => {
    const res = await post(makeHarness(), { ...SAME_ORIGIN });
    expect(res.status).toBe(200);
  });

  it("actor 未启用 TOTP 却带 code → 忽略并成功（不 400）", async () => {
    const harness = makeHarness();
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "alice", password: NEW_PASSWORD, code: "999999" }),
    });
    expect(res.status).toBe(200);
    expect(harness.totpCalls).toEqual([]); // 未启用就不验，码也不进日志
  });

  it("actor 启用 TOTP：缺 code → 401 且不写盘、目标会话仍有效", async () => {
    const harness = makeHarness();
    const targetSession = await harness.store.create("alice", 600_000);
    const res = await post(harness, { ...SAME_ORIGIN, cookie: "dsh_auth=totpadmin" });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid_totp" });
    expect(harness.hashCalls).toEqual([]);
    expect(harness.revokes).toEqual([]);
    expect(harness.store.getByToken(targetSession.token)).toBeDefined();
  });

  it("actor 启用 TOTP：错码 → 401", async () => {
    const harness = makeHarness();
    const res = await post(harness, {
      ...SAME_ORIGIN,
      cookie: "dsh_auth=totpadmin",
      body: form({ target: "alice", password: NEW_PASSWORD, code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(harness.hashCalls).toEqual([]);
  });

  it("同窗重放（replayCheck=false）→ 401，且用命中 counter 判重放", async () => {
    const replayCheck = vi.fn(() => false);
    const harness = makeHarness({ replayCheck });
    const res = await post(harness, {
      ...SAME_ORIGIN,
      cookie: "dsh_auth=totpadmin",
      body: form({ target: "alice", password: NEW_PASSWORD, code: "123456" }),
    });
    expect(res.status).toBe(401);
    expect(replayCheck).toHaveBeenCalledWith("totpadmin", 7, "123456");
    expect(harness.hashCalls).toEqual([]);
  });

  it("actor 启用 TOTP：正确码 → 200，审计 reauth=totp", async () => {
    const harness = makeHarness();
    const res = await post(harness, {
      ...SAME_ORIGIN,
      cookie: "dsh_auth=totpadmin",
      body: form({ target: "alice", password: NEW_PASSWORD, code: "123456" }),
    });
    expect(res.status).toBe(200);
    expect(harness.audits()[0]?.reauth).toBe("totp");
  });

  it("目标自己的 TOTP 不参与（目标有 secret 也无所谓）", async () => {
    const harness = makeHarness();
    harness.users.set("bob", {
      passwordHash: "hb",
      disabled: false,
      role: "user",
      totpSecret: "B",
    });
    const res = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "bob", password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(harness.totpCalls).toEqual([]);
  });
});

describe("目标名校验与 query 忽略（验收 18）", () => {
  const invalidTargets = ["", ".", "..", "a b", "x".repeat(65), "-abc", "a/b", "a\\b"];
  for (const target of invalidTargets) {
    it(`非法目标 ${JSON.stringify(target)} → 400 且不触盘`, async () => {
      const harness = makeHarness();
      const res = await post(harness, {
        ...SAME_ORIGIN,
        body: form({ target, password: NEW_PASSWORD }),
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: "bad_target" });
      expect(harness.hashCalls).toEqual([]);
      expect(harness.revokes).toEqual([]);
    });
  }

  it("query 里的 target 被忽略：以 body 为准", async () => {
    const harness = makeHarness();
    const req = makeReq({
      body: form({ target: "alice", password: NEW_PASSWORD }),
      secFetchSite: "same-origin",
    });
    req.url = "/auth/users/password?target=admin";
    const res = makeRes();
    await handleResetPassword(harness.deps, req, res.res);
    expect(res.status).toBe(200);
    expect(harness.revokes).toEqual(["alice"]);
    expect(harness.users.get("admin")?.passwordHash).toBe("hash-old");
  });
});
