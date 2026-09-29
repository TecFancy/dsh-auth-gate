import { describe, expect, it } from "vitest";
import { compareNames } from "../../shared/index.js";
import { handleResetPassword } from "./endpoints.js";
import {
  form,
  makeHarness,
  makeReq,
  makeRes,
  type FakeRes,
  type Harness,
  type ReqOptions,
} from "./test-harness.js";

/**
 * grok #4 子项：审计 `target` 的控制符剥离。
 * 业务字段 `ctx.target` 必须保持原值（USERNAME_RE 仍看到原始字符串），只有审计副本被清洗。
 */
const PW = "Denied-Passw0rd!9";
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

/** 与 audit.ts 的 isInvisible 同口径：C0、DEL/C1、行分隔符、双向控制符、零宽字符。 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code === 0x2028 || code === 0x2029) return true;
    if (code >= 0x202a && code <= 0x202e) return true;
    if (code >= 0x2066 && code <= 0x2069) return true;
    if (code >= 0x200b && code <= 0x200f) return true;
    if (code === 0xfeff) return true;
  }
  return false;
}

interface Sent {
  res: FakeRes;
  harness: Harness;
}

async function post(options: ReqOptions, target: string): Promise<Sent> {
  const harness = makeHarness();
  const res = makeRes();
  await handleResetPassword(
    harness.deps,
    makeReq({ body: form({ target, password: PW }), ...options }),
    res.res,
  );
  return { res, harness };
}

function auditTarget(harness: Harness): string {
  return harness.audits()[0]?.target ?? "";
}

describe("审计 target 控制符剥离（grok #4）", () => {
  it("控制符 payload：日志 target 无 C0/DEL 且 ≤64（未认证 bad_origin 路径）", async () => {
    // 10 个 Z + 4 个控制符，重复 10 次 → 剥掉控制符后剩 100 个 Z（>64，必须同时触发截断）
    const dirty = `${"Z".repeat(10)}\u0000\r\n\t\u007f`.repeat(10);
    const { res, harness } = await post({ cookie: null }, dirty);
    expect(res.status).toBe(403);
    const target = auditTarget(harness);
    expect(hasControlChars(target)).toBe(false);
    expect(target.length).toBeLessThanOrEqual(64);
    expect(target).toBe(`${"Z".repeat(61)}...`);
    const dump = JSON.stringify(harness.logs.map((entry) => entry.message));
    expect(dump).not.toContain("\u0000");
    expect(dump).not.toContain("\u0007");
  });

  it("8KB 原始 target 仍被截断到 ≤64（回归 F2）", async () => {
    const { res, harness } = await post({ cookie: null }, "Z".repeat(8000));
    expect(res.status).toBe(403);
    expect(auditTarget(harness)).toBe(`${"Z".repeat(61)}...`);
  });

  it("业务字段保持原值：含 \\u0000 的目标名仍被 USERNAME_RE 拒绝（400）", async () => {
    const { res, harness } = await post(SAME_ORIGIN, "alice\u0000");
    expect(res.status).toBe(400);
    expect(res.body).toBe(JSON.stringify({ error: "bad_target" }));
    // 审计副本已清洗，但校验用的是原值（否则 "alice\u0000" 会被当成 "alice" 放行）
    const event = harness.audits()[0];
    expect(event?.reason).toBe("bad_target");
    expect(event?.target).toBe("alice");
  });

  it("清洗后的 denied 事件仍是固定 10 键（键集合相等）", async () => {
    const { harness } = await post({ cookie: null }, "Z\u0000".repeat(40));
    const event = harness.audits()[0];
    expect(Object.keys(event ?? {}).sort((a, b) => compareNames(a, b))).toEqual(FIELDS);
    expect(event?.event).toBe("audit.user.password_reset.denied");
  });

  it("复审补强：C1 / 行分隔符 / 双向控制符 / 零宽字符同样剥掉", async () => {
    // \u0085 NEL 在 Latin-1 头里合法、\u202e 能篡改日志阅读方向、\u200b/\ufeff 不可见。
    const dirty = "a\u0085b\u2028c\u202ed\u200be\ufefff";
    const { res, harness } = await post({ cookie: null }, dirty);
    expect(res.status).toBe(403);
    expect(auditTarget(harness)).toBe("abcdef");
    expect(hasControlChars(JSON.stringify(harness.logs.map((entry) => entry.message)))).toBe(false);
  });
});
