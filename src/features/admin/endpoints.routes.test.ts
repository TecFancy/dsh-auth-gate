import { describe, expect, it } from "vitest";
import { makeAdminRoutes } from "./endpoints.js";
import { form, makeHarness, makeReq, makeRes, type Harness } from "./test-harness.js";

const NEW_PASSWORD = "NewPassw0rd!XY";
const SAME_ORIGIN = { secFetchSite: "same-origin" };

describe("makeAdminRoutes（冻结接口）", () => {
  it("返回两条 handler，`/auth/users` 与 `/auth/users/password` 各司其职", async () => {
    const harness = makeHarness();
    const routes = makeAdminRoutes(harness.deps);
    const list = makeRes();
    await routes.users(makeReq({ method: "GET" }), list.res);
    expect(list.status).toBe(200);
    const reset = makeRes();
    await routes.resetPassword(
      makeReq({ body: form({ target: "alice", password: NEW_PASSWORD }), ...SAME_ORIGIN }),
      reset.res,
    );
    expect(reset.status).toBe(200);
    expect(harness.revokes).toEqual(["alice"]);
  });

  it("受限会话打管理重置 → 403（不是 gate 302，也不落进 401）", async () => {
    const harness = makeHarness();
    const routes = makeAdminRoutes(harness.deps);
    const res = makeRes();
    await routes.resetPassword(
      makeReq({
        body: form({ target: "alice", password: NEW_PASSWORD }),
        cookie: "dsh_auth=restricted",
        ...SAME_ORIGIN,
      }),
      res.res,
    );
    expect(res.status).toBe(403);
    expect(harness.audits()[0]).toMatchObject({ reason: "forbidden", actor: "admin" });
    expect(harness.hashCalls).toEqual([]);
  });
});

describe("body 流异常（无 status）", () => {
  it("向上抛，不吞成 4xx/5xx", async () => {
    const harness: Harness = makeHarness();
    const req = makeReq({ ...SAME_ORIGIN });
    // 覆盖 body 迭代器：next() 直接 reject（不带 status 的流异常必须向上抛）。
    Object.defineProperty(req, Symbol.asyncIterator, {
      value: () => ({ next: () => Promise.reject(new Error("stream boom")) }),
    });
    await expect(makeAdminRoutes(harness.deps).resetPassword(req, makeRes().res)).rejects.toThrow(
      "stream boom",
    );
  });
});
