import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_PASSWORD,
  VICTIM_PASSWORD,
  VICTIM_RESET_PASSWORD,
  VICTIM_TOTP_SECRET,
  get,
  loginBody,
  mountP2Stack,
  postForm,
  postLogin,
  resetBody,
  unmountP2Stack,
  type P2Stack,
} from "./integration-p2-helpers.js";

/** 管理面契约 §8-A/§8-B：列表、重置、顺序、Origin 矩阵、目标 TOTP 字节不动。 */

async function withStack(scenario: (stack: P2Stack) => Promise<void>): Promise<void> {
  const stack = await mountP2Stack();
  try {
    await scenario(stack);
  } finally {
    await unmountP2Stack(stack);
  }
}

async function adminCookie(stack: P2Stack): Promise<string> {
  const res = await postLogin(stack.base, loginBody("admin", ADMIN_PASSWORD));
  if (res.status !== 302 || res.cookie === undefined) {
    throw new Error(`admin login failed: ${res.status}`);
  }
  return res.cookie;
}

async function scenarioUsersMatrix(stack: P2Stack): Promise<void> {
  expect((await get(stack.base, "/auth/users")).status).toBe(401);

  const victim = await postLogin(stack.base, loginBody("victim", VICTIM_PASSWORD));
  expect(victim.status).toBe(302);
  expect((await get(stack.base, "/auth/users", { cookie: victim.cookie })).status).toBe(403);

  const admin = await adminCookie(stack);
  const res = await get(stack.base, "/auth/users", { cookie: admin });
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body) as { users: Record<string, unknown>[] };
  expect(body.users.map((user) => user["name"])).toEqual(["admin", "victim"]);
  for (const user of body.users) {
    // 键集合相等：多一个 hash/totpSecret/salt 字段都会红。
    expect(new Set(Object.keys(user))).toEqual(
      new Set(["name", "role", "disabled", "totpEnabled", "mustChangePassword"]),
    );
  }
  expect(body.users[0]).toMatchObject({ name: "admin", role: "admin", disabled: false });
  expect(body.users[1]).toMatchObject({
    name: "victim",
    role: "user",
    totpEnabled: true,
    mustChangePassword: false,
  });
  expect(res.body).not.toContain(VICTIM_TOTP_SECRET);
}

async function scenarioMethodMatrix(stack: P2Stack): Promise<void> {
  const post = await postForm(stack.base, "/auth/users", {}, { origin: null });
  expect(post.status).toBe(405);
  expect(post.allow).toBe("GET");

  const getReset = await get(stack.base, "/auth/users/password");
  expect(getReset.status).toBe(405);
  expect(getReset.allow).toBe("POST");
}

async function scenarioResetChain(stack: P2Stack): Promise<void> {
  const victimCookie = (await postLogin(stack.base, loginBody("victim", VICTIM_PASSWORD))).cookie;
  const admin = await adminCookie(stack);
  const before = await fs.readFile(stack.usersFile, "utf8");

  const res = await postForm(
    stack.base,
    "/auth/users/password",
    resetBody("victim", VICTIM_RESET_PASSWORD),
    { cookie: admin },
  );
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true, sessionsRevoked: true });

  // 目标会话全线失效（本设备 + 其它设备都靠 revokeBySubject），actor 自己不受影响。
  expect((await get(stack.base, "/__probe", { cookie: victimCookie })).status).toBe(401);
  expect((await get(stack.base, "/auth/users", { cookie: admin })).status).toBe(200);

  const after = await fs.readFile(stack.usersFile, "utf8");
  expect(after).toContain("must_change_password: true");
  expect(after).toContain(VICTIM_TOTP_SECRET); // TOTP 字节不动
  expect(before).toContain(VICTIM_TOTP_SECRET); // 前置事实：夹具里本来就有 secret

  // 目标用新口令登录 -> 拿到受限会话（登录门生效）。
  const relogin = await postLogin(stack.base, loginBody("victim", VICTIM_RESET_PASSWORD));
  expect(relogin.status).toBe(302);
  expect(relogin.location).toBe("/auth/password");
}

async function scenarioOriginMatrix(stack: P2Stack): Promise<void> {
  const admin = await adminCookie(stack);
  const body = resetBody("victim", VICTIM_RESET_PASSWORD);

  // 缺 Origin（已认证）-> 403，不是 401：Origin 判定在会话判定之前（契约 §2 顺序）。
  const missing = await postForm(stack.base, "/auth/users/password", body, {
    cookie: admin,
    origin: null,
  });
  expect(missing.status).toBe(403);

  // 缺 Origin 且未认证 -> 仍是 403（同样证明了顺序）。
  expect((await postForm(stack.base, "/auth/users/password", body, { origin: null })).status).toBe(
    403,
  );

  const evil = await postForm(stack.base, "/auth/users/password", body, {
    cookie: admin,
    origin: "https://evil.example",
  });
  expect(evil.status).toBe(403);

  // same-origin（同 host 不同 scheme）也不算：只认精确的对外来源。
  const sameSite = await postForm(stack.base, "/auth/users/password", body, {
    cookie: admin,
    origin: "http://dsh.example.test",
  });
  expect(sameSite.status).toBe(403);

  // 正例之一：浏览器自证来源。
  const secFetch = await postForm(stack.base, "/auth/users/password", body, {
    cookie: admin,
    origin: null,
    secFetchSite: "same-origin",
  });
  expect(secFetch.status).toBe(200);
}

async function scenarioAuthzOrder(stack: P2Stack): Promise<void> {
  const admin = await adminCookie(stack);
  const victim = await postLogin(stack.base, loginBody("victim", VICTIM_PASSWORD));

  // 非 admin + 不存在的目标 -> 403（不是 404）：不给非 admin 探存在性的通道。
  const probing = await postForm(
    stack.base,
    "/auth/users/password",
    resetBody("ghost", VICTIM_RESET_PASSWORD),
    { cookie: victim.cookie },
  );
  expect(probing.status).toBe(403);

  const ghost = await postForm(
    stack.base,
    "/auth/users/password",
    resetBody("ghost", VICTIM_RESET_PASSWORD),
    { cookie: admin },
  );
  expect(ghost.status).toBe(404);

  const self = await postForm(
    stack.base,
    "/auth/users/password",
    resetBody("admin", VICTIM_RESET_PASSWORD),
    { cookie: admin },
  );
  expect(self.status).toBe(403);

  const badName = await postForm(
    stack.base,
    "/auth/users/password",
    resetBody("../etc/passwd", VICTIM_RESET_PASSWORD),
    { cookie: admin },
  );
  expect(badName.status).toBe(400);

  // 策略拒绝（长度不够）-> 400，且不写盘。
  const weak = await postForm(stack.base, "/auth/users/password", resetBody("victim", "short"), {
    cookie: admin,
  });
  expect(weak.status).toBe(400);
  expect(await fs.readFile(stack.usersFile, "utf8")).not.toContain("must_change_password: true");
}

async function scenarioQueryTarget(stack: P2Stack): Promise<void> {
  const admin = await adminCookie(stack);
  const res = await postForm(
    stack.base,
    "/auth/users/password?target=admin",
    resetBody("victim", VICTIM_RESET_PASSWORD),
    { cookie: admin },
  );
  expect(res.status).toBe(200);
  const yaml = await fs.readFile(stack.usersFile, "utf8");
  // 以 body 为准：victim 被标记，admin 不受影响。
  expect(yaml).toContain("must_change_password: true");
  expect(yaml.split("must_change_password")).toHaveLength(2);
}

describe("integration P2: GET /auth/users", () => {
  it("runs the 401 / 403 / 200 matrix and returns the whitelisted projection", () =>
    withStack(scenarioUsersMatrix));

  it("keeps the method matrix (405 + allow) for both admin routes", () =>
    withStack(scenarioMethodMatrix));
});

/**
 * ★#10 真值：重置成功后清目标限流桶、★#13 同码重放（登录 ↔ 管理面共用一个单例）
 * 这两条加固用例在 `src/integration.p2-admin-hardening.test.ts`（守住本文件行数上限）。
 */

describe("integration P2: GET /auth/users", () => {
  it("runs the 401 / 403 / 200 matrix and returns the whitelisted projection", () =>
    withStack(scenarioUsersMatrix));

  it("keeps the method matrix (405 + allow) for both admin routes", () =>
    withStack(scenarioMethodMatrix));
});

describe("integration P2: POST /auth/users/password", () => {
  it("resets the target: marks, revokes every target session, keeps target TOTP bytes", () =>
    withStack(scenarioResetChain));

  it("enforces the Origin / Sec-Fetch-Site matrix with fail-closed responses", () =>
    withStack(scenarioOriginMatrix));

  it("keeps the authorization order: 403 before 404, self-reset 403, bad name 400", () =>
    withStack(scenarioAuthzOrder));

  it("ignores a target smuggled through the query string", () => withStack(scenarioQueryTarget));
});
