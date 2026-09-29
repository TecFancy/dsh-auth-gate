import { describe, expect, it } from "vitest";
import { compareNames } from "../../shared/index.js";
import type { AdminDenyReason } from "./audit.js";
import type { AdminDeps } from "./deps.js";
import { handleResetPassword, handleUsers } from "./endpoints.js";
import {
  form,
  makeHarness,
  makeReq,
  makeRes,
  type Harness,
  type ReqOptions,
} from "./test-harness.js";

const NEW_PASSWORD = "NewPassw0rd!XY";
/** 通过策略的哨兵口令（拒绝路径里必须一次都不出现在日志）。 */
const PW = "Denied-Passw0rd!9";
const WEAK = "weak-pw";
const CODE = "987654";
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
const REASONS: AdminDenyReason[] = [
  "self",
  "forbidden",
  "bad_origin",
  "bad_target",
  "not_found",
  "bad_reauth",
  "policy",
  "rate_limited",
  "io",
  "unauthenticated",
];

async function post(
  harness: Harness,
  options: ReqOptions = {},
): Promise<ReturnType<typeof makeRes>> {
  const res = makeRes();
  const body = options.body ?? form({ target: "alice", password: NEW_PASSWORD });
  await handleResetPassword(harness.deps, makeReq({ body, ...options }), res.res);
  return res;
}

function dump(harness: Harness): string {
  return harness.logs
    .map((entry) => `${entry.level}: ${JSON.stringify(entry.message) ?? String(entry.message)}`)
    .join("\n");
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort((a, b) => compareNames(a, b));
}

function auditKeys(harness: Harness): string[] {
  return sortedKeys(harness.audits()[0] ?? {});
}

describe("审计字段与成功事件（验收 17）", () => {
  it("成功事件：10 键恒定 + 字段值", async () => {
    const harness = makeHarness();
    await post(harness, { ...SAME_ORIGIN });
    expect(harness.audits()).toHaveLength(1);
    expect(auditKeys(harness)).toEqual(FIELDS);
    expect(harness.audits()[0]).toEqual({
      event: "audit.user.password_reset",
      ts: 1_700_000_000_000,
      actor: "admin",
      target: "alice",
      clientIp: "127.0.0.1",
      ok: true,
      reason: undefined,
      reauth: "none",
      sessionsRevoked: true,
      targetDisabled: false,
    });
    expect(harness.logs[0]?.level).toBe("info");
  });

  it("revoke 失败：成功事件提级 error（仍只发一条）", async () => {
    const harness = makeHarness({ revokeSubject: () => Promise.resolve(false) });
    await post(harness, { ...SAME_ORIGIN });
    expect(harness.audits()).toHaveLength(1);
    expect(harness.audits()[0]?.sessionsRevoked).toBe(false);
    expect(harness.logs[0]?.level).toBe("error");
  });

  it("GET /auth/users 不产生审计", async () => {
    const harness = makeHarness();
    const res = makeRes();
    await handleUsers(harness.deps, makeReq({ method: "GET" }), res.res);
    expect(res.status).toBe(200);
    expect(harness.logs).toEqual([]);
  });
});

/** 逐条制造 10 个 reason 的真实拒绝；返回该用例提交的明文（供日志扫描）。 */
async function denyCase(
  reason: AdminDenyReason,
): Promise<{ harness: Harness; password: string; code: string }> {
  const harness = makeHarness(
    reason === "io"
      ? ({
          mutateUsers: () => Promise.reject(new Error("users file is locked")),
        } satisfies Partial<AdminDeps>)
      : {},
  );
  const body = form({ target: "alice", password: PW });
  if (reason === "self") {
    await post(harness, { ...SAME_ORIGIN, body: form({ target: "admin", password: PW }) });
  } else if (reason === "forbidden") {
    await post(harness, { ...SAME_ORIGIN, cookie: "dsh_auth=alice" });
  } else if (reason === "bad_origin") {
    await post(harness, { body });
  } else if (reason === "bad_target") {
    await post(harness, { ...SAME_ORIGIN, body: form({ target: "..", password: PW }) });
  } else if (reason === "not_found") {
    await post(harness, { ...SAME_ORIGIN, body: form({ target: "ghost", password: PW }) });
  } else if (reason === "bad_reauth") {
    await post(harness, {
      ...SAME_ORIGIN,
      cookie: "dsh_auth=totpadmin",
      body: form({ target: "alice", password: PW, code: CODE }),
    });
  } else if (reason === "policy") {
    await post(harness, { ...SAME_ORIGIN, body: form({ target: "alice", password: WEAK }) });
  } else if (reason === "rate_limited") {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      harness.limiter.recordFailure("127.0.0.1", "admin");
    }
    await post(harness, { ...SAME_ORIGIN, body });
  } else if (reason === "io") {
    await post(harness, { ...SAME_ORIGIN, body });
  } else {
    await post(harness, { ...SAME_ORIGIN, cookie: null, body });
  }
  return {
    harness,
    password: reason === "policy" ? WEAK : PW,
    code: reason === "bad_reauth" ? CODE : "",
  };
}

describe("拒绝事件：10 个 reason 的形状与键集合（F6）", () => {
  for (const reason of REASONS) {
    it(`${reason}：恰好一条 denied + 键集合相等`, async () => {
      const { harness } = await denyCase(reason);
      const events = harness.audits();
      expect(events).toHaveLength(1);
      expect(sortedKeys(events[0] ?? {})).toEqual(FIELDS);
      expect(events[0]).toMatchObject({
        event: "audit.user.password_reset.denied",
        reason,
        ok: false,
        sessionsRevoked: false,
      });
    });
  }

  it("未认证拒绝走 info、已认证拒绝走 error（F2 降噪；未认证 bad_origin 见 origin 用例）", async () => {
    for (const reason of REASONS) {
      const { harness } = await denyCase(reason);
      const expected = reason === "unauthenticated" ? "info" : "error";
      expect([reason, harness.logs[0]?.level]).toEqual([reason, expected]);
    }
  });
});

describe("拒绝路径明文扫描（F6）", () => {
  for (const reason of REASONS) {
    it(`${reason}：logger 入参对象不含口令 / code / 哈希`, async () => {
      const { harness, password, code } = await denyCase(reason);
      const text = dump(harness);
      expect(text).not.toContain(password);
      if (code !== "") expect(text).not.toContain(code);
      expect(text).not.toContain("scrypt$stub$");
      expect(text).not.toContain("hash-old");
    });
  }
});

describe("脱敏：扫 logger 入参对象（验收 17）", () => {
  it("成功路径日志不含口令 / code / 哈希", async () => {
    const harness = makeHarness();
    await post(harness, {
      ...SAME_ORIGIN,
      cookie: "dsh_auth=totpadmin",
      body: form({ target: "alice", password: NEW_PASSWORD, code: "123456" }),
    });
    const text = dump(harness);
    expect(text).not.toContain(NEW_PASSWORD);
    expect(text).not.toContain("123456");
    expect(text).not.toContain("scrypt$stub$");
  });

  it("失败路径日志（含 io 错误消息）不含口令 / code", async () => {
    const harness = makeHarness({
      mutateUsers: () => Promise.reject(new Error(`cannot write: ${NEW_PASSWORD}`)),
    });
    await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "alice", password: NEW_PASSWORD, code: CODE }),
    });
    const text = dump(harness);
    expect(text).not.toContain(NEW_PASSWORD);
    expect(text).not.toContain(CODE);
    expect(text).toContain("cannot write");
  });

  it("audit 事件对象里只出现 target 用户名（必要且非敏感）", async () => {
    const harness = makeHarness();
    harness.users.set("bob", { passwordHash: "hb", disabled: false, role: "user" });
    await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "bob", password: NEW_PASSWORD }),
    });
    const text = dump(harness);
    expect(text).toContain('"target":"bob"');
    expect(text).not.toContain("hb");
  });
});
