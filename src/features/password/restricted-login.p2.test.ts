import { describe, expect, it, vi } from "vitest";
import { digestToken } from "../../session/index.js";
import {
  aliceChallengeCookie,
  makeHarness,
  post,
  SECRET_ALICE,
  sessionToken,
} from "../../../test/password-totp-harness.js";
import { CHALLENGE_COOKIE } from "./challenge-cookie.js";
import { RESTRICTED_SESSION_TTL_SECONDS } from "./restricted-session.js";

const FULL_TTL_MS = 604_800_000;

describe("登录门：must_change_password 分支（验收 20/21/32）", () => {
  it("issues a full session for a user without the marker (20/32 回归)", async () => {
    const h = makeHarness();
    const res = await post(h, "POST", "username=bob&password=pw&next=%2Fdashboard");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/dashboard");
    const row = h.table.get(digestToken(sessionToken(res.headers)))!;
    expect(row.kind).toBe("full");
    expect(row.expiresAt - row.createdAt).toBe(FULL_TTL_MS);
  });

  it("issues a restricted session, ignores next, cookie shape unchanged (21)", async () => {
    const h = makeHarness();
    h.users.get("bob")!.mustChangePassword = true;
    const res = await post(h, "POST", "username=bob&password=pw&next=%2Ffoo");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/password"); // 忽略 next，不送回宿主
    const token = sessionToken(res.headers);
    const row = h.table.get(digestToken(token))!;
    expect(row).toMatchObject({ subject: "bob", revoked: false, kind: "password-change-only" });
    expect(row.expiresAt - row.createdAt).toBe(RESTRICTED_SESSION_TTL_SECONDS * 1000);
    // cookie 名/属性/路径与正式会话完全一致，只有 Max-Age 不同（15 分钟）
    expect(res.headers["set-cookie"]).toBe(
      `dsh_auth=${token}; Max-Age=${RESTRICTED_SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax`,
    );
  });

  it("issues a restricted session after the TOTP second stage too (21)", async () => {
    const h = makeHarness();
    h.users.get("alice")!.mustChangePassword = true;
    h.setVerifyImpl((secret, code) =>
      secret === SECRET_ALICE && code === "123456" ? 7 : undefined,
    );
    const first = await post(h, "POST", "username=alice&password=pw&next=%2Ffoo");
    expect(first.status).toBe(302);
    expect(first.headers["set-cookie"]).toContain(`${CHALLENGE_COOKIE}=`);
    expect(h.table.size).toBe(0); // 第一段不发会话

    const res = await post(h, "POST", "code=123456", aliceChallengeCookie());
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/password");
    const row = h.table.get(digestToken(sessionToken(res.headers)))!;
    expect(row.kind).toBe("password-change-only");
    expect(row.expiresAt - row.createdAt).toBe(RESTRICTED_SESSION_TTL_SECONDS * 1000);
  });

  it("skips the launch-token bridge for restricted, keeps it for full", async () => {
    const marked = makeHarness();
    marked.users.get("bob")!.mustChangePassword = true;
    marked.deps.launchTokenBridge = () => Promise.resolve("/?token=bridge");
    const restricted = await post(marked, "POST", "username=bob&password=pw");
    expect(restricted.headers["location"]).toBe("/auth/password");

    const plain = makeHarness();
    plain.deps.launchTokenBridge = () => Promise.resolve("/?token=bridge");
    const full = await post(plain, "POST", "username=bob&password=pw");
    expect(full.headers["location"]).toBe("/?token=bridge");
  });
});

describe("登录失败不可区分（验收 22）", () => {
  it("wrong password: status/body/cookie/session identical with and without the marker", async () => {
    const run = async (marked: boolean) => {
      const h = makeHarness();
      h.users.get("bob")!.mustChangePassword = marked;
      const res = await post(h, "POST", "username=bob&password=wrong");
      return {
        status: res.status,
        body: res.body,
        setCookie: res.headers["set-cookie"],
        sessions: h.table.size,
      };
    };
    expect(await run(true)).toEqual(await run(false));
  });

  it("wrong TOTP: stage-1 challenge and stage-2 rejection identical either way", async () => {
    const run = async (marked: boolean) => {
      const h = makeHarness();
      h.users.get("alice")!.mustChangePassword = marked;
      const stage1 = await post(h, "POST", "username=alice&password=pw");
      const res = await post(h, "POST", "code=000000", aliceChallengeCookie());
      return {
        stage1Status: stage1.status,
        stage1Cookie: stage1.headers["set-cookie"],
        status: res.status,
        body: res.body,
        setCookie: res.headers["set-cookie"],
        sessions: h.table.size,
      };
    };
    expect(await run(true)).toEqual(await run(false));
  });
});

describe("受限会话 TTL 到期（验收 30）", () => {
  it("expires after 15 minutes; re-login re-issues a restricted session (no renewal)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const h = makeHarness();
      h.users.get("bob")!.mustChangePassword = true;
      const first = await post(h, "POST", "username=bob&password=pw");
      const store = h.storeOf()!;
      const token = sessionToken(first.headers);
      expect(store.getByToken(token)?.kind).toBe("password-change-only");

      vi.setSystemTime(1_700_000_000_000 + RESTRICTED_SESSION_TTL_SECONDS * 1000 + 1);
      expect(store.getByToken(token)).toBeUndefined(); // 到期 = 按未认证处理

      const again = await post(h, "POST", "username=bob&password=pw");
      expect(again.headers["location"]).toBe("/auth/password");
      const row = store.getByToken(sessionToken(again.headers))!;
      expect(row.kind).toBe("password-change-only"); // 标记仍在 → 再发受限，不续期
      expect(row.expiresAt - row.createdAt).toBe(RESTRICTED_SESSION_TTL_SECONDS * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
