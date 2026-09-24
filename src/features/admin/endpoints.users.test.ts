import { describe, expect, it } from "vitest";
import { compareNames } from "../../shared/index.js";
import type { UserRecord } from "../../shared/index.js";
import { handleUsers } from "./endpoints.js";
import { jsonBody, makeHarness, makeReq, makeRes, type Harness } from "./test-harness.js";

async function get(
  harness: Harness,
  options: Parameters<typeof makeReq>[0] = {},
): Promise<ReturnType<typeof makeRes>> {
  const res = makeRes();
  await handleUsers(harness.deps, makeReq({ method: "GET", ...options }), res.res);
  return res;
}

function keysOf(value: object): string[] {
  return Object.keys(value).sort((a, b) => compareNames(a, b));
}

const USER_FIELDS = ["disabled", "mustChangePassword", "name", "role", "totpEnabled"];

describe("GET /auth/users: 鉴权（验收 1）", () => {
  it("无会话 → 401 unauthorized", async () => {
    const res = await get(makeHarness(), { cookie: null });
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "unauthorized" });
  });

  it("会话存储不可用 → 401（无有效会话可言）", async () => {
    const res = await get(makeHarness({ sessions: () => undefined }));
    expect(res.status).toBe(401);
  });

  it("有会话但非 admin → 403（不是 404）", async () => {
    const res = await get(makeHarness(), { cookie: "dsh_auth=alice" });
    expect(res.status).toBe(403);
    expect(jsonBody(res)).toEqual({ error: "forbidden" });
  });

  it("受限会话（admin + password-change-only）→ 403", async () => {
    const res = await get(makeHarness(), { cookie: "dsh_auth=restricted" });
    expect(res.status).toBe(403);
  });

  it("被禁用的 admin → 403（每请求现读 yaml）", async () => {
    const harness = makeHarness();
    harness.users.set("admin", { ...harness.users.get("admin")!, disabled: true });
    expect((await get(harness)).status).toBe(403);
  });

  it("admin → 200 + 全量列表", async () => {
    const res = await get(makeHarness());
    expect(res.status).toBe(200);
    const body = jsonBody(res) as { users: { name: string }[] };
    expect(body.users.map((user) => user.name)).toEqual(["admin", "alice", "totpadmin"]);
  });
});

describe("GET /auth/users: 字段白名单（验收 2/3）", () => {
  it("每个用户对象键集合精确相等（多一个 secret 字段就红）", async () => {
    const res = await get(makeHarness());
    const body = jsonBody(res) as { users: object[] };
    expect(keysOf(body)).toEqual(["users"]);
    for (const view of body.users) expect(keysOf(view)).toEqual(USER_FIELDS);
  });

  it("投影值正确：role / disabled / totpEnabled / mustChangePassword", async () => {
    const harness = makeHarness();
    harness.users.set("bob", { passwordHash: "h", disabled: true, role: "user" });
    harness.users.set("carol", { passwordHash: "h", disabled: false, mustChangePassword: true });
    const body = jsonBody(await get(harness)) as { users: Record<string, unknown>[] };
    const byName = new Map(body.users.map((view) => [view["name"], view]));
    expect(byName.get("bob")).toEqual({
      name: "bob",
      role: "user",
      disabled: true,
      totpEnabled: false,
      mustChangePassword: false,
    });
    expect(byName.get("carol")).toMatchObject({ role: "user", mustChangePassword: true });
    expect(byName.get("totpadmin")).toMatchObject({ role: "admin", totpEnabled: true });
  });

  it("响应头：no-store + pragma no-cache + application/json", async () => {
    const res = await get(makeHarness());
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["content-type"]).toBe("application/json");
  });

  it("字段缺失不 500：缺 role/mustChangePassword 的旧记录照常列出", async () => {
    const harness = makeHarness();
    const legacy: UserRecord = { passwordHash: "h", disabled: false };
    harness.users.set("legacy", legacy);
    const res = await get(harness);
    expect(res.status).toBe(200);
    const body = jsonBody(res) as { users: Record<string, unknown>[] };
    const view = body.users.find((entry) => entry["name"] === "legacy");
    expect(view).toEqual({
      name: "legacy",
      role: "user",
      disabled: false,
      totpEnabled: false,
      mustChangePassword: false,
    });
  });

  it("users 文件读失败 → 503（系统错误不冒充 401/403）", async () => {
    const res = await get(makeHarness({ loadUsers: () => Promise.reject(new Error("bad yaml")) }));
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toBe("text/plain");
  });
});

describe("GET /auth/users: 方法与排序（验收 4/5）", () => {
  it("POST → 405 + allow: GET", async () => {
    const res = makeRes();
    await handleUsers(makeHarness().deps, makeReq({ method: "POST", body: "" }), res.res);
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET /auth/users/password → 405 + allow: POST", async () => {
    const { handleResetPassword } = await import("./endpoints.js");
    const res = makeRes();
    await handleResetPassword(
      makeHarness().deps,
      makeReq({ method: "GET", cookie: null }),
      res.res,
    );
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
  });

  it("禁用用户照常列出", async () => {
    const harness = makeHarness();
    harness.users.set("zoe", { passwordHash: "h", disabled: true, role: "user" });
    const body = jsonBody(await get(harness)) as { users: { name: string; disabled: boolean }[] };
    expect(body.users.at(-1)).toEqual({
      name: "zoe",
      role: "user",
      disabled: true,
      totpEnabled: false,
      mustChangePassword: false,
    });
  });
});
