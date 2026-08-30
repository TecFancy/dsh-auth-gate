import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { PasswordGate } from "./password-gate.js";
import type { SessionStore } from "../../session/index.js";

function fakeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

function fakeSessions(validTokens: ReadonlySet<string>): SessionStore {
  const session = {
    subject: "alice",
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
    revoked: false,
  };
  return {
    getByToken: (token: string) => (validTokens.has(token) ? session : undefined),
  } as unknown as SessionStore;
}

function makeGate(options?: {
  sessions?: () => SessionStore | undefined;
  cookieName?: string;
}): PasswordGate {
  return new PasswordGate({
    sessions: options?.sessions ?? (() => undefined),
    cookieName: options?.cookieName ?? "dsh_auth",
  });
}

describe("PasswordGate", () => {
  it("allows the /auth whitelist with no credentials at all", () => {
    const gate = makeGate();
    expect(gate.decide(fakeReq({}), "exact", "/auth")).toBe("allow");
    expect(gate.decide(fakeReq({}), "exact", "/auth/login")).toBe("allow");
    expect(gate.decide(fakeReq({}), "prefix", "/auth/whatever")).toBe("allow");
  });

  it("allows a valid session cookie and rejects unknown/expired/revoked tokens", () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["good-session"])) });
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=unknown" }), "exact", "/probe")).toBe("deny");
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=revoked" }), "exact", "/probe")).toBe("deny");
    expect(gate.decide(fakeReq({}), "exact", "/probe")).toBe("deny");
  });

  it("allows a session token via Bearer and accepts case variants", () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["session-tok"])) });
    expect(gate.decide(fakeReq({ authorization: "Bearer session-tok" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(gate.decide(fakeReq({ authorization: "bearer session-tok" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(gate.decide(fakeReq({ authorization: "Bearer unknown" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(gate.decide(fakeReq({ authorization: "Token session-tok" }), "exact", "/probe")).toBe(
      "deny",
    );
  });

  it("denies everything (except whitelist) when sessions are unavailable", () => {
    const gate = makeGate({ sessions: () => undefined });
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(gate.decide(fakeReq({ authorization: "Bearer session-tok" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(gate.decide(fakeReq({}), "upgrade", "/api/events.host")).toBe("deny");
  });

  it("returns synchronously (no promise)", () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["t"])) });
    const decision = gate.decide(fakeReq({ cookie: "dsh_auth=t" }), "exact", "/probe");
    expect(typeof decision).toBe("string");
    expect(decision).toBe("allow");
  });
});
