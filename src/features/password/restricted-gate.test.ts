import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { GateDecision, GuardKind } from "../../gate/index.js";
import { denyHttp, guardHttp, isNavigationRequest } from "../../gate/index.js";
import { SessionStore } from "../../session/index.js";
import { makeRes, MemTable } from "../../../test/password-totp-harness.js";
import { PasswordGate } from "./password-gate.js";
import { RESTRICTED_REDIRECT_PATH, RESTRICTED_SESSION_TTL_SECONDS } from "./restricted-session.js";

type Kind = "full" | "password-change-only";

function req(headers: Record<string, string>, method = "GET", url = "/"): IncomingMessage {
  return { method, url, headers } as unknown as IncomingMessage;
}

/** 造一个带指定 kind 会话的 store（P2 验收 20/21/23/28/30/31 的公共前置）。 */
async function sessionOfKind(
  kind: Kind,
  ttlMs = 60_000,
): Promise<{ store: SessionStore; cookie: string }> {
  const store = new SessionStore(new MemTable());
  const { token } = await store.create("alice", ttlMs, kind);
  return { store, cookie: `dsh_auth=${token}` };
}

function gateFor(store: SessionStore): PasswordGate {
  return new PasswordGate({ sessions: () => store, cookieName: "dsh_auth" });
}

describe("PasswordGate：受限会话的允许集（契约 §3 表；验收 21/24/25）", () => {
  it("allows only the written-down /auth entries, subdividing /auth/login", async () => {
    const { store, cookie } = await sessionOfKind("password-change-only");
    const gate = gateFor(store);
    const decide = (method: string, pathname: string, kind: GuardKind = "exact"): GateDecision =>
      gate.decide(req({ cookie }, method, pathname), kind, pathname);

    expect(decide("GET", "/auth/password")).toBe("allow");
    expect(decide("POST", "/auth/password")).toBe("allow");
    expect(decide("GET", "/auth/status")).toBe("allow");
    expect(decide("POST", "/auth/logout")).toBe("allow");
    // `/auth/users*` 放行进 handler：管理面 handler 回 403（**不是** gate 302/401，验收 24）
    expect(decide("GET", "/auth/users")).toBe("allow");
    expect(decide("POST", "/auth/users/password")).toBe("allow");
    // 登录门：GET → 302 改密页（不双表单）；POST → 403（换人先 logout）
    expect(decide("GET", "/auth/login")).toEqual({
      deny: { redirect: RESTRICTED_REDIRECT_PATH },
    });
    expect(decide("POST", "/auth/login")).toEqual({ deny: { status: 403 } });
    expect(decide("PUT", "/auth/login")).toEqual({ deny: { status: 403 } });
  });
});

describe("PasswordGate：受限会话访问宿主路径（验收 23/28/30/31）", () => {
  it("denies host paths: navigation 302 /auth/password, API 401, WS handshake", async () => {
    const { store, cookie } = await sessionOfKind("password-change-only");
    const gate = gateFor(store);

    expect(
      gate.decide(
        req({ cookie, "sec-fetch-mode": "navigate" }, "GET", "/api/x"),
        "exact",
        "/api/x",
      ),
    ).toEqual({ deny: { redirect: RESTRICTED_REDIRECT_PATH } });
    expect(
      gate.decide(
        req({ cookie, "sec-fetch-dest": "document" }, "GET", "/dash"),
        "fallback",
        "/dash",
      ),
    ).toEqual({ deny: { redirect: RESTRICTED_REDIRECT_PATH } });
    expect(gate.decide(req({ cookie }, "GET", "/api/x"), "exact", "/api/x")).toEqual({
      deny: { status: 401 },
    });
    expect(
      gate.decide(req({ cookie }, "GET", "/api/events.host"), "upgrade", "/api/events.host"),
    ).toEqual({ deny: { upgrade: true } });
    // 公开静态白名单不给受限会话开洞：静态与 /plugins 一样 deny
    expect(
      gate.decide(
        req({ cookie }, "GET", "/manifest.webmanifest"),
        "fallback",
        "/manifest.webmanifest",
      ),
    ).toEqual({ deny: { status: 401 } });
    expect(
      gate.decide(req({ cookie }, "GET", "/plugins/x.js"), "fallback", "/plugins/x.js"),
    ).toEqual({ deny: { status: 401 } });
  });

  it("trusts only session.kind: cleared marker + failed revoke stays restricted (28)", async () => {
    // 清标记成功 + revoke 注入失败：gate 看不到（也不许看）users.yaml，旧 cookie 仍是受限。
    const { store, cookie } = await sessionOfKind("password-change-only");
    expect(gateFor(store).decide(req({ cookie }, "GET", "/probe"), "exact", "/probe")).toEqual({
      deny: { status: 401 },
    });
    // 反向：yaml 标记仍在、会话却是 full（revoke 失败残，D22）→ gate 放行，绝不按 yaml 降权。
    const full = await sessionOfKind("full");
    expect(
      gateFor(full.store).decide(req({ cookie: full.cookie }, "GET", "/probe"), "exact", "/probe"),
    ).toBe("allow");
  });
});

describe("PasswordGate：受限会话的时效与吊销（验收 30/31/回归）", () => {
  it("treats an expired restricted session as unauthenticated, never renewing it (30)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const ttlMs = RESTRICTED_SESSION_TTL_SECONDS * 1000;
      const { store, cookie } = await sessionOfKind("password-change-only", ttlMs);
      const gate = gateFor(store);
      expect(gate.decide(req({ cookie }, "GET", "/probe"), "exact", "/probe")).toEqual({
        deny: { status: 401 },
      });

      vi.setSystemTime(1_700_000_000_000 + ttlMs + 1);
      // 到期 = 普通未认证：宿主导航回登录页；POST /auth/login 恢复可达（重登再拿受限）
      expect(
        gate.decide(
          req({ cookie, "sec-fetch-mode": "navigate" }, "GET", "/probe"),
          "exact",
          "/probe",
        ),
      ).toEqual({ deny: { redirect: "/auth/login?next=%2Fprobe" } });
      expect(gate.decide(req({ cookie }, "POST", "/auth/login"), "exact", "/auth/login")).toBe(
        "allow",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates the old cookie once the subject is revoked (不升级，31)", async () => {
    const { store, cookie } = await sessionOfKind("password-change-only");
    const gate = gateFor(store);
    expect(gate.decide(req({ cookie }, "GET", "/probe"), "exact", "/probe")).toEqual({
      deny: { status: 401 },
    });

    await store.revokeBySubject("alice"); // 改密成功后的全踢（handler 侧）
    expect(
      gate.decide(
        req({ cookie, "sec-fetch-mode": "navigate" }, "GET", "/probe"),
        "exact",
        "/probe",
      ),
    ).toEqual({ deny: { redirect: "/auth/login?next=%2Fprobe" } });
    expect(gate.decide(req({ cookie }, "GET", "/probe"), "exact", "/probe")).toBe("deny");
  });

  it("keeps full sessions and anonymous navigation unchanged (回归 20/32)", async () => {
    const full = await sessionOfKind("full");
    expect(
      gateFor(full.store).decide(req({ cookie: full.cookie }, "GET", "/probe"), "exact", "/probe"),
    ).toBe("allow");

    const anon = gateFor(new SessionStore(new MemTable()));
    expect(anon.decide(req({}, "GET", "/probe"), "exact", "/probe")).toBe("deny");
    expect(
      anon.decide(req({ "sec-fetch-mode": "navigate" }, "GET", "/probe"), "exact", "/probe"),
    ).toEqual({
      deny: { redirect: "/auth/login?next=%2Fprobe" },
    });
    expect(anon.decide(req({}, "GET", "/auth/login"), "exact", "/auth/login")).toBe("allow");
  });
});

describe("guard 渲染与 Sec-Fetch 判定（P2 §3）", () => {
  it("never treats Accept as navigation (fail-closed → API 401)", () => {
    const res = makeRes();
    denyHttp(req({ accept: "text/html" }, "GET", "/x"), res.res);
    expect(res.status).toBe(401);
    expect(res.body).toBe("unauthorized");
    expect(isNavigationRequest(req({ "sec-fetch-mode": "NAVIGATE" }))).toBe(true);
    expect(isNavigationRequest(req({ "sec-fetch-dest": "Document" }))).toBe(true);
    expect(isNavigationRequest(req({ "sec-fetch-mode": "cors" }))).toBe(false);
    expect(isNavigationRequest(req({ accept: "text/html" }))).toBe(false);
  });

  it("renders gate-given redirect/403 decisions and sanitizes Location", async () => {
    const handler = (): void => {
      throw new Error("guarded handler must not run");
    };
    const redirect = makeRes();
    await guardHttp(
      () => ({ decide: () => ({ deny: { redirect: "/auth/password" } }) }),
      "exact",
      handler,
    )(req({}, "GET", "/api/x"), redirect.res);
    expect(redirect.status).toBe(302);
    expect(redirect.headers["location"]).toBe("/auth/password");
    expect(redirect.headers["cache-control"]).toBe("no-store");

    const forbidden = makeRes();
    await guardHttp(
      () => ({ decide: () => ({ deny: { status: 403 } }) }),
      "exact",
      handler,
    )(req({}, "GET", "/api/x"), forbidden.res);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toBe("forbidden");

    const unsafe = makeRes();
    await guardHttp(
      () => ({ decide: () => ({ deny: { redirect: "//evil.com" } }) }),
      "exact",
      handler,
    )(req({}), unsafe.res);
    expect(unsafe.headers["location"]).toBe("/auth/login");
  });
});
