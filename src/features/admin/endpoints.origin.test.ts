import { describe, expect, it } from "vitest";
import { handleResetPassword } from "./endpoints.js";
import type { AdminDeps } from "./deps.js";
import {
  form,
  makeHarness,
  makeReq,
  makeRes,
  type Harness,
  type ReqOptions,
} from "./test-harness.js";

const NEW_PASSWORD = "NewPassw0rd!XY";
const BODY = form({ target: "alice", password: NEW_PASSWORD });

async function post(
  harness: Harness,
  options: ReqOptions = {},
): Promise<{ status: number | undefined; body: string }> {
  const res = makeRes();
  await handleResetPassword(harness.deps, makeReq({ body: BODY, ...options }), res.res);
  return res;
}

function harnessWith(publicHost: string, overrides: Partial<AdminDeps> = {}): Harness {
  return makeHarness({ publicHost, ...overrides });
}

describe("Origin / Sec-Fetch-Site 矩阵（验收 15）", () => {
  it("Sec-Fetch-Site: same-origin → 放行（无需 Origin）", async () => {
    const res = await post(harnessWith("dsh.example.com"), { secFetchSite: "same-origin" });
    expect(res.status).toBe(200);
  });

  it("Origin 等于 publicHost 解析出的对外来源 → 放行", async () => {
    const res = await post(harnessWith("dsh.example.com"), { origin: "http://dsh.example.com" });
    expect(res.status).toBe(200);
  });

  it("publicHost 带 https:// 时按 scheme 精确比对", async () => {
    const harness = harnessWith("https://dsh.example.com");
    expect((await post(harness, { origin: "https://dsh.example.com" })).status).toBe(200);
    expect((await post(harness, { origin: "http://dsh.example.com" })).status).toBe(403);
  });

  it("publicHost 未配置：Origin 不得靠 Host 放行", async () => {
    const res = await post(harnessWith(""), {
      origin: "http://127.0.0.1:3080",
      host: "127.0.0.1:3080",
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
  });

  it("子域 Origin → 403", async () => {
    const res = await post(harnessWith("dsh.example.com"), {
      origin: "http://evil.dsh.example.com",
    });
    expect(res.status).toBe(403);
  });

  it("same-site 但非 same-origin → 403", async () => {
    const res = await post(harnessWith("dsh.example.com"), {
      origin: "http://other.example.com",
      secFetchSite: "same-site",
    });
    expect(res.status).toBe(403);
  });

  it("Origin: null → 403", async () => {
    const res = await post(harnessWith("dsh.example.com"), { origin: "null" });
    expect(res.status).toBe(403);
  });

  it("两者都缺 → 403（fail-closed）", async () => {
    const res = await post(harnessWith("dsh.example.com"));
    expect(res.status).toBe(403);
  });

  it("明文连接 + publicHost 只写 host：https Origin 不匹配", async () => {
    const res = await post(harnessWith("dsh.example.com"), {
      origin: "https://dsh.example.com",
      encrypted: false,
    });
    expect(res.status).toBe(403);
  });

  it("TLS 连接 + publicHost 只写 host：https Origin 匹配", async () => {
    const res = await post(harnessWith("dsh.example.com"), {
      origin: "https://dsh.example.com",
      encrypted: true,
    });
    expect(res.status).toBe(200);
  });
});

describe("Origin 拒绝的审计与顺序（验收 15/17）", () => {
  it("bad_origin 进审计，且发生在 401 之前（未认证 → info，不进告警桶）", async () => {
    const harness = harnessWith("dsh.example.com");
    const res = await post(harness, { cookie: null, origin: "http://evil.example.com" });
    expect(res.status).toBe(403); // 不是 401
    const events = harness.audits();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "audit.user.password_reset.denied",
      reason: "bad_origin",
      ok: false,
      actor: "",
    });
    expect(harness.logs[0]?.level).toBe("info");
  });

  it("F2：无认证 + 无 Origin + 8KB target → 403，审计 info 级且 target 截断到 64", async () => {
    const harness = harnessWith("dsh.example.com");
    const huge = "Z".repeat(8000);
    const res = await post(harness, {
      cookie: null,
      body: form({ target: huge, password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect(harness.logs[0]?.level).toBe("info");
    const event = harness.audits()[0];
    expect(event?.reason).toBe("bad_origin");
    expect(event?.actor).toBe("");
    expect((event?.target ?? "").length).toBeLessThanOrEqual(64);
    expect(event?.target.endsWith("...")).toBe(true);
    expect(JSON.stringify(harness.logs.map((entry) => entry.message))).not.toContain(huge);
  });

  it("Origin 失败不消耗限流桶（探测者拿不到 429 反馈）", async () => {
    const harness = harnessWith("dsh.example.com");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await post(harness, { origin: "http://evil.example.com" })).status).toBe(403);
    }
    expect(harness.limiter.check("127.0.0.1", "admin").allowed).toBe(true);
  });
});
