import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import type { SessionStore } from "../../../entities/session/index.js";
import type { SessionKind } from "../../../shared/protocol/index.js";
import { safeEqual, TokenGate } from "./token-gate.js";

function fakeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

function fakeSessions(validTokens: ReadonlySet<string>): SessionStore {
  const session = {
    subject: "token",
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
    revoked: false,
  };
  return {
    getByToken: (token: string) => (validTokens.has(token) ? session : undefined),
  } as unknown as SessionStore;
}

function makeGate(options?: {
  resolveToken?: () => Promise<string | undefined>;
  sessions?: () => SessionStore | undefined;
  cookieName?: string;
}): TokenGate {
  return new TokenGate({
    resolveToken: options?.resolveToken ?? (() => Promise.resolve(undefined)),
    sessions: options?.sessions ?? (() => undefined),
    cookieName: options?.cookieName ?? "dsh_auth",
  });
}

describe("TokenGate", () => {
  it("allows the /auth whitelist with no credentials at all", async () => {
    const gate = makeGate();
    expect(await gate.decide(fakeReq({}), "exact", "/auth")).toBe("allow");
    expect(await gate.decide(fakeReq({}), "exact", "/auth/login")).toBe("allow");
    expect(await gate.decide(fakeReq({}), "prefix", "/auth/whatever")).toBe("allow");
  });

  it("allows the public read-only static whitelist on HTTP but never on upgrade", async () => {
    const gate = makeGate();
    expect(await gate.decide(fakeReq({}), "fallback", "/manifest.webmanifest")).toBe("allow");
    expect(await gate.decide(fakeReq({}), "exact", "/manifest.webmanifest")).toBe("allow");
    // upgrade 只有认证一条路（白名单不含握手）。
    expect(await gate.decide(fakeReq({}), "upgrade", "/manifest.webmanifest")).toBe("deny");
    // 精确匹配：不加前缀、不容尾斜杠、不放行相邻路径。
    expect(await gate.decide(fakeReq({}), "fallback", "/manifest.webmanifest/")).toBe("deny");
    expect(await gate.decide(fakeReq({}), "fallback", "/manifest.webmanifest.bak")).toBe("deny");
    expect(await gate.decide(fakeReq({}), "fallback", "/assets/index.js")).toBe("deny");
  });

  it("allows a valid session cookie and falls through otherwise", async () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["good-session"])) });
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=unknown" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=revoked" }), "exact", "/probe")).toBe(
      "deny",
    );
  });

  it("allows a correct bearer token, rejects a wrong one, and accepts case variants", async () => {
    const token = "top-secret";
    const gate = makeGate({ resolveToken: () => Promise.resolve(token) });
    expect(
      await gate.decide(fakeReq({ authorization: `Bearer ${token}` }), "exact", "/probe"),
    ).toBe("allow");
    expect(
      await gate.decide(fakeReq({ authorization: `bearer ${token}` }), "exact", "/probe"),
    ).toBe("allow");
    expect(await gate.decide(fakeReq({ authorization: "Bearer wrong" }), "exact", "/probe")).toBe(
      "deny",
    );
  });

  it("skips the cookie channel without sessions but still honors bearer", async () => {
    const token = "top-secret";
    const gate = makeGate({
      sessions: () => undefined,
      resolveToken: () => Promise.resolve(token),
    });
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(
      await gate.decide(
        fakeReq({ cookie: "dsh_auth=good-session", authorization: `Bearer ${token}` }),
        "exact",
        "/probe",
      ),
    ).toBe("allow");
  });

  it("denies without any credential", async () => {
    const gate = makeGate();
    expect(await gate.decide(fakeReq({}), "exact", "/probe")).toBe("deny");
    expect(await gate.decide(fakeReq({}), "upgrade", "/api/events.host")).toBe("deny");
  });

  it("denies (fail-closed) when the resolver throws", async () => {
    const gate = makeGate({
      resolveToken: () => Promise.reject(new Error("boom")),
    });
    await expect(
      gate.decide(fakeReq({ authorization: "Bearer x" }), "exact", "/probe"),
    ).resolves.toBe("deny");
  });
});

describe("safeEqual", () => {
  it("matches known vectors", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("TokenGate: first-run bootstrap channel", () => {
  function fakeSessionsWithKind(kind: SessionKind): SessionStore {
    const session = {
      subject: "bootstrap",
      createdAt: 0,
      expiresAt: Date.now() + 60_000,
      revoked: false,
      kind,
    };
    return { getByToken: () => session } as unknown as SessionStore;
  }

  it("redirects a bare token launch URL to the bootstrap endpoint", async () => {
    const gate = makeGate();
    expect(
      await gate.decide(
        { method: "GET", url: "/?token=launch-token", headers: {} } as IncomingMessage,
        "exact",
        "/",
      ),
    ).toEqual({ deny: { redirect: "/auth/bootstrap?token=launch-token" } });
  });

  it("leaves every other anonymous request on the plain deny", async () => {
    const gate = makeGate();
    expect(await gate.decide(fakeReq({}), "exact", "/api/x")).toBe("deny");
    expect(await gate.decide(fakeReq({}), "exact", "/")).toBe("deny");
    expect(
      await gate.decide(
        { method: "POST", url: "/?token=x", headers: {} } as IncomingMessage,
        "exact",
        "/",
      ),
    ).toBe("deny");
  });

  it("keeps a bootstrap session inside /auth", async () => {
    const gate = makeGate({ sessions: () => fakeSessionsWithKind("bootstrap") });
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=boot" }), "exact", "/auth/setup")).toBe(
      "allow",
    );
    expect(
      await gate.decide(
        fakeReq({ cookie: "dsh_auth=boot", "sec-fetch-dest": "document" }),
        "exact",
        "/",
      ),
    ).toEqual({ deny: { redirect: "/auth/setup" } });
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=boot" }), "exact", "/api/x")).toBe("deny");
    // 公开静态路径也不例外：bootstrap 会话只能碰本插件的 /auth/*。
    expect(
      await gate.decide(fakeReq({ cookie: "dsh_auth=boot" }), "fallback", "/manifest.webmanifest"),
    ).toBe("deny");
  });

  it("still lets a full session through", async () => {
    const gate = makeGate({ sessions: () => fakeSessionsWithKind("full") });
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=full" }), "exact", "/api/x")).toBe(
      "allow",
    );
  });
});
