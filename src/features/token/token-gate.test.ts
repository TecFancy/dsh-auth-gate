import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import type { SessionStore } from "../../session/index.js";
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
