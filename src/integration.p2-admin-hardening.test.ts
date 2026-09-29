import { describe, expect, it } from "vitest";
import { totpCodeAt } from "./features/totp/index.js";
import { currentCode } from "./integration-totp-helpers.js";
import {
  ADMIN_PASSWORD,
  ADMIN_TOTP_SECRET,
  VICTIM_NEW_PASSWORD,
  VICTIM_PASSWORD,
  VICTIM_RESET_PASSWORD,
  changeBody,
  cookiePair,
  loginBody,
  mountP2Stack,
  postForm,
  postLogin,
  resetBody,
  unmountP2Stack,
  type MountP2Options,
  type P2Stack,
} from "./integration-p2-helpers.js";

/**
 * 管理面加固用例（真栈）。从 `src/integration.p2-admin.test.ts` 拆出以守住 250 行上限：
 * - ★#10 真值：重置成功后**清目标限流桶**（而不是只有 spy 覆盖）；
 * - ★#13 真值：登录与管理重置**共用同一个 `TotpReplayGuard` 单例**（同码不能在两处各用一次）。
 */

async function withStack(
  scenario: (stack: P2Stack) => Promise<void>,
  options: MountP2Options = {},
): Promise<void> {
  const stack = await mountP2Stack(options);
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

/**
 * 桶按 (IP, 账号) 双键，`clearAccount` 只清账号桶（IP 桶留着，清它等于给攻击者发豁免），
 * 所以"打爆"与"验证"必须用不同客户端 IP，才能把账号桶是否被清单独测出来。
 */
async function scenarioRateBucketReset(stack: P2Stack): Promise<void> {
  const lockIp = "10.0.0.9";
  const freshIp = "10.0.0.10";
  const changeLockIp = "10.0.0.11";
  const changeFreshIp = "10.0.0.12";

  const victim = await postLogin(stack.base, loginBody("victim", VICTIM_PASSWORD));
  expect(victim.status).toBe(302);

  // 打爆 victim 的自助改密账号桶（P1 桶）
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await postForm(
      stack.base,
      "/auth/password",
      changeBody("wrong-current-1A!", VICTIM_NEW_PASSWORD),
      { cookie: victim.cookie, forwardedFor: changeLockIp },
    );
  }
  // 打爆 victim 的登录账号桶
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await postLogin(stack.base, loginBody("victim", "Wrong-pw-1A!"), { forwardedFor: lockIp });
  }
  // 控制组：换干净 IP 仍被账号桶挡住（没有重置就不该能登录）
  const locked = await postLogin(stack.base, loginBody("victim", VICTIM_PASSWORD), {
    forwardedFor: freshIp,
  });
  expect(locked.status).toBe(429);

  const admin = await adminCookie(stack);
  const reset = await postForm(
    stack.base,
    "/auth/users/password",
    resetBody("victim", VICTIM_RESET_PASSWORD),
    { cookie: admin },
  );
  expect(reset.status).toBe(200);

  // 账号桶已清：同样从干净 IP 用新口令登录 → 受限会话
  const relogin = await postLogin(stack.base, loginBody("victim", VICTIM_RESET_PASSWORD), {
    forwardedFor: freshIp,
  });
  expect(relogin.status).toBe(302);
  expect(relogin.location).toBe("/auth/password");

  // 自助改密桶同样已清：受限会话带正确 current 改密 → 302（不是 429）
  const changed = await postForm(
    stack.base,
    "/auth/password",
    changeBody(VICTIM_RESET_PASSWORD, VICTIM_NEW_PASSWORD),
    { cookie: relogin.cookie, forwardedFor: changeFreshIp },
  );
  expect(changed.status).toBe(302);
  expect(changed.location).toBe("/auth/login?notice=password-changed");
}

/**
 * 等到一个新的 30s 窗口开始，并留足剩余时间（默认 12s）。
 *
 * TOTP 用例必须在窗口**起点附近**跑：否则整套 coverage 下的慢用例会让场景跨窗口，
 * `expect(floor(now/30s)).toBe(window)` 这种「同一窗口」前提断言就会随机变红
 * （2026-09-24 Windows CI 实测抖动一次）。最坏要等约 12s，所以用到它的两个用例显式
 * 给 30s 超时（vitest 默认 10s，等待本身就能把用例顶爆）。
 */
async function freshTotpWindow(minRemainingMs = 12_000): Promise<number> {
  let counter = Math.floor(Date.now() / 30_000);
  while (30_000 - (Date.now() % 30_000) < minRemainingMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    counter = Math.floor(Date.now() / 30_000);
  }
  return counter;
}

/** actor 开 TOTP（`totp: "optional"`）后，登录消费的码在管理重置里必须被判重放。 */
async function scenarioTotpReplaySingleton(stack: P2Stack): Promise<void> {
  const window = await freshTotpWindow();
  const code = currentCode(ADMIN_TOTP_SECRET);

  const stage1 = await postLogin(stack.base, loginBody("admin", ADMIN_PASSWORD));
  expect(stage1.status).toBe(302);
  const challenge = cookiePair(stage1, "dsh_auth_challenge");
  expect(challenge).toBeDefined();

  // 第二段：同一窗口的 code → 正式会话（这一步把码消费掉）
  const stage2 = await postLogin(stack.base, `code=${code}`, { cookie: challenge });
  expect(stage2.status).toBe(302);
  const admin = cookiePair(stage2, "dsh_auth");
  expect(admin).toBeDefined();

  // 同一枚码再用于管理重置 → 401（同一单例判重放）
  const replay = await postForm(
    stack.base,
    "/auth/users/password",
    { ...resetBody("victim", VICTIM_RESET_PASSWORD), code },
    { cookie: admin },
  );
  expect(replay.status).toBe(401);
  // 前提：上面两步必须落在同一 30s 窗口内，否则 401 可能来自"过期码"而不是重放。
  expect(Math.floor(Date.now() / 30_000)).toBe(window);
  // 对照组：管理面确实要码（无码 → 401），所以上面的 401 不是"一律拒绝"造成的假绿。
  const withoutCode = await postForm(
    stack.base,
    "/auth/users/password",
    resetBody("victim", VICTIM_RESET_PASSWORD),
    { cookie: admin },
  );
  expect(withoutCode.status).toBe(401);
}

/**
 * 上一窗口的码换出正式会话（验证器带 ±1 窗口）：把**当前**窗口的码留给被测请求，
 * 否则同窗内"登录先用掉唯一合法码"会让管理重置恒判重放。
 */
async function fullAdminSession(stack: P2Stack): Promise<string> {
  const counter = Math.floor(Date.now() / 30_000);
  const stage1 = await postLogin(stack.base, loginBody("admin", ADMIN_PASSWORD));
  expect(stage1.status).toBe(302);
  const challenge = cookiePair(stage1, "dsh_auth_challenge");
  expect(challenge).toBeDefined();
  const stage2 = await postLogin(stack.base, `code=${totpCodeAt(ADMIN_TOTP_SECRET, counter - 1)}`, {
    cookie: challenge,
  });
  expect(stage2.status).toBe(302);
  const cookie = cookiePair(stage2, "dsh_auth");
  expect(cookie).toBeDefined();
  return cookie!;
}

/**
 * 管理桶计失败（grok 实现期复审 G1）：`fail()` 覆盖 TOTP/policy/bad_target/not_found/self，
 * 所以连续错码必须累计到 429；同时**登录桶不受影响**（两个 limiter 是不同实例，这是
 * 评审对上一轮 F3「未证明管理桶与那两只桶隔离」复核意见的正面证据）。
 */
async function scenarioAdminBucketCountsFailures(stack: P2Stack): Promise<void> {
  const ip = "10.0.2.1";
  const admin = await fullAdminSession(stack);

  const ladder: number[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await postForm(
      stack.base,
      "/auth/users/password",
      { ...resetBody("victim", VICTIM_RESET_PASSWORD), code: "000000" },
      { cookie: admin, forwardedFor: ip },
    );
    ladder.push(res.status);
  }
  expect(ladder).toContain(401); // 错码确实是 401（不是一律 429）
  expect(ladder).toContain(429); // 失败计进管理桶后触发锁定

  // 控制组：同一 IP 的登录桶没被带锁（管理桶是独立实例、独立键空间）。
  const stillLogsIn = await postLogin(stack.base, loginBody("admin", ADMIN_PASSWORD), {
    forwardedFor: ip,
  });
  expect(stillLogsIn.status).toBe(302);
  expect(cookiePair(stillLogsIn, "dsh_auth_challenge")).toBeDefined();
}

/** 一次重置消费掉自己的码（grok 实现期复审 G8）：同窗口内第二次用同一枚码必须 401。 */
async function scenarioResetConsumesOwnCode(stack: P2Stack): Promise<void> {
  const counter = await freshTotpWindow();
  const admin = await fullAdminSession(stack);
  const code = currentCode(ADMIN_TOTP_SECRET);

  const first = await postForm(
    stack.base,
    "/auth/users/password",
    { ...resetBody("victim", VICTIM_RESET_PASSWORD), code },
    { cookie: admin },
  );
  expect(first.status).toBe(200);

  const second = await postForm(
    stack.base,
    "/auth/users/password",
    { ...resetBody("victim", "Second-pw-7cret!"), code },
    { cookie: admin },
  );
  expect(second.status).toBe(401);
  // 前提：两次都在同一 30s 窗口内，401 才只能是重放（不是过期码）。
  expect(Math.floor(Date.now() / 30_000)).toBe(counter);
  // 生效的是第一次的口令：重放没有二次写盘。
  // 本栈 totp: "optional" 且 victim 带 secret ⇒ 登录第一段就是 302 + 挑战 cookie。
  const withFirst = await postLogin(stack.base, loginBody("victim", VICTIM_RESET_PASSWORD));
  expect(withFirst.status).toBe(302);
  expect(cookiePair(withFirst, "dsh_auth_challenge")).toBeDefined();
  const withSecond = await postLogin(stack.base, loginBody("victim", "Second-pw-7cret!"));
  expect(withSecond.status).toBe(401);
}

describe("integration P2: admin reset hardening", () => {
  it("clears both target rate-limit buckets so the reset user can log in and change again", () =>
    withStack(scenarioRateBucketReset));

  it(
    "shares one TOTP replay guard between login and the admin reset",
    () => withStack(scenarioTotpReplaySingleton, { adminTotpSecret: ADMIN_TOTP_SECRET }),
    30_000,
  );

  it("counts denied attempts in the admin bucket without locking the login bucket", () =>
    withStack(scenarioAdminBucketCountsFailures, { adminTotpSecret: ADMIN_TOTP_SECRET }));

  it(
    "consumes the TOTP code of a reset exactly once",
    () => withStack(scenarioResetConsumesOwnCode, { adminTotpSecret: ADMIN_TOTP_SECRET }),
    30_000,
  );
});
