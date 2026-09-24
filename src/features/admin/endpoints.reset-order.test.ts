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
const BODY = form({ target: "alice", password: NEW_PASSWORD });
const SAME_ORIGIN = { secFetchSite: "same-origin" };

async function post(
  harness: Harness,
  options: ReqOptions = {},
): Promise<{ status: number | undefined; headers: Record<string, string>; body: string }> {
  const res = makeRes();
  await handleResetPassword(harness.deps, makeReq({ body: BODY, ...options }), res.res);
  return res;
}

describe("POST /auth/users/password: 单条管道上的顺序（验收 6）", () => {
  it("405 → 415 → 413 → Origin 403 → 401 → 非 admin 403 → 429 → 404 → self 403", async () => {
    const harness = makeHarness();
    // 405：方法门最先，畸形 body / 缺 Origin 都不影响
    const method = await post(harness, { method: "DELETE", cookie: null, contentType: null });
    expect(method.status).toBe(405);
    expect(method.headers["allow"]).toBe("POST");
    // 415：content-type 门在 Origin 之前
    const media = await post(harness, {
      cookie: null,
      contentType: "application/json",
      body: "{}",
    });
    expect(media.status).toBe(415);
    // 413：体量门在 Origin 之前（且带 connection: close）
    const oversized = await post(harness, {
      cookie: null,
      body: Buffer.alloc(16 * 1024 + 1, 0x61),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers["connection"]).toBe("close");
    // Origin 门在 401 之前：缺 Origin 的已认证请求 403，而不是 401
    const missingOrigin = await post(harness, { cookie: "dsh_auth=admin" });
    expect(missingOrigin.status).toBe(403);
    // 401：Origin 通过、无 cookie
    expect((await post(harness, { ...SAME_ORIGIN, cookie: null })).status).toBe(401);
    // 403：非 admin（登录态有效也不是 404）
    expect((await post(harness, { ...SAME_ORIGIN, cookie: "dsh_auth=alice" })).status).toBe(403);
    // 403：非 admin + 目标不存在（存在性隔离）
    const probe = await post(harness, {
      ...SAME_ORIGIN,
      cookie: "dsh_auth=alice",
      body: form({ target: "ghost", password: NEW_PASSWORD }),
    });
    expect(probe.status).toBe(403);
    // 429：限流桶在 404 之前
    for (let attempt = 0; attempt < 5; attempt += 1)
      harness.limiter.recordFailure("127.0.0.1", "admin");
    const locked = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "ghost", password: NEW_PASSWORD }),
    });
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBeDefined();
    harness.limiter.recordSuccess("127.0.0.1", "admin");
    // 404：桶已清、admin 通过、目标仍不存在
    const ghost = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "ghost", password: NEW_PASSWORD }),
    });
    expect(ghost.status).toBe(404);
    // 403 self：目标存在且就是 actor
    const self = await post(harness, {
      ...SAME_ORIGIN,
      body: form({ target: "admin", password: NEW_PASSWORD }),
    });
    expect(self.status).toBe(403);
  });

  it("顺序走完后同一条管道仍能成功（无状态污染）", async () => {
    const harness = makeHarness();
    expect((await post(harness, { ...SAME_ORIGIN })).status).toBe(200);
    expect(harness.revokes).toEqual(["alice"]);
  });
});
