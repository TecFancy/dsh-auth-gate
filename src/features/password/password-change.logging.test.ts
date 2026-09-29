import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "../../shared/index.js";
import type { UserRecord } from "../../shared/index.js";
import type { Session, SessionStore } from "../../session/index.js";
import { handlePasswordChange, type PasswordChangeDeps } from "./password-change.js";

/** 高熵哨兵：任何一条日志里出现它们就是明文泄漏。 */
const CURRENT = "CURRENT-PLAINTEXT-SENTINEL";
const NEW_PASSWORD = "New-PLAINTEXT-SENTINEL1!";
const CODE = "654321";
const OLD_HASH = "scrypt$65536$8$1$old";
const FIXED_NOW = 1_700_000_000_000;

interface LogEntry {
  level: string;
  message: unknown;
}

interface FakeRes {
  res: ServerResponse;
  status: number | undefined;
  body: string;
}

function makeRes(): FakeRes {
  const state = { status: undefined as number | undefined, body: "" };
  const res = {
    setHeader: (): void => undefined,
    writeHead: (status: number): void => {
      state.status = status;
    },
    end: (body?: string): void => {
      state.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return Object.assign(state, { res });
}

function makeReq(body: string, cookie: string | null = "dsh_auth=good"): IncomingMessage {
  return {
    method: "POST",
    url: "/auth/password",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // P2 §6：改密 POST 要求同源证明（浏览器表单/同源 fetch 恒带该头）。
      "sec-fetch-site": "same-origin",
      ...(cookie === null ? {} : { cookie }),
    },
    socket: { remoteAddress: "127.0.0.1" },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      yield Buffer.from(body);
    },
  } as unknown as IncomingMessage;
}

const USER: UserRecord = {
  passwordHash: OLD_HASH,
  totpSecret: "TOTP-SECRET",
  disabled: false,
  role: "user",
  mustChangePassword: false,
};

function makeHarness(overrides: Partial<PasswordChangeDeps> = {}): {
  deps: PasswordChangeDeps;
  logs: LogEntry[];
} {
  const logs: LogEntry[] = [];
  const users = new Map<string, UserRecord>([["alice", { ...USER }]]);
  const session: Session = {
    subject: "alice",
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    revoked: false,
  };
  const store = { getByToken: () => session } as unknown as SessionStore;
  const deps: PasswordChangeDeps = {
    sessions: () => store,
    cookieName: "dsh_auth",
    cookieSecure: false,
    usersPath: "/tmp/users.yaml",
    loadUsers: () => Promise.resolve({ snapshot: { users }, missing: false }),
    mutateUsers: async (mutator) => {
      await mutator({ users });
    },
    verify: (password) => Promise.resolve(password === CURRENT),
    hash: () => Promise.resolve("scrypt$65536$8$1$new"),
    limiter: new LoginRateLimiter(),
    totpMode: "optional",
    verifyTotp: (_secret, code) => (code === CODE ? 7 : undefined),
    replayCheck: () => true,
    revoke: () => Promise.resolve(),
    now: () => FIXED_NOW,
    logger: {
      error: (message) => logs.push({ level: "error", message }),
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
    },
    ...overrides,
  };
  return { deps, logs };
}

async function send(deps: PasswordChangeDeps, body: string): Promise<number | undefined> {
  const res = makeRes();
  await handlePasswordChange(deps, makeReq(body), res.res);
  return res.status;
}

function dump(logs: LogEntry[]): string {
  return logs.map((entry) => `${entry.level}: ${String(entry.message)}`).join("\n");
}

function expectNoPlaintext(logs: LogEntry[]): void {
  const text = dump(logs);
  for (const secret of [CURRENT, NEW_PASSWORD, CODE]) expect(text).not.toContain(secret);
}

function form(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

describe("audit log redaction (§0/§1)", () => {
  it("logs the success constant and never the plaintext", async () => {
    const { deps, logs } = makeHarness({ totpMode: "off" });
    expect(await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }))).toBe(
      200,
    );
    expect(logs).toContainEqual({ level: "info", message: "password changed" });
    expectNoPlaintext(logs);
  });

  it("keeps every rejection on constant messages and never the plaintext", async () => {
    const { deps, logs } = makeHarness();
    expect(await send(deps, form({ current: "wrong", password: NEW_PASSWORD, code: CODE }))).toBe(
      401,
    );
    expect(await send(deps, form({ current: CURRENT, password: "short", code: CODE }))).toBe(400);
    expect(
      await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: "000000" })),
    ).toBe(401);
    expect(dump(logs)).toContain("password change rejected");
    expect(logs.every((entry) => entry.level === "info")).toBe(true);
    expectNoPlaintext(logs);
  });

  it("logs rate limiting with the existing constant and never the plaintext", async () => {
    const limiter = new LoginRateLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure("127.0.0.1", "alice");
    const { deps, logs } = makeHarness({ limiter });
    expect(await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }))).toBe(
      429,
    );
    expect(dump(logs)).toContain("rate limit exceeded");
    expectNoPlaintext(logs);
  });

  it("redacts a leaky users-store write error instead of logging the plaintext", async () => {
    const { deps, logs } = makeHarness({
      mutateUsers: () => Promise.reject(new Error(`write failed for ${NEW_PASSWORD}`)),
    });
    expect(await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }))).toBe(
      503,
    );
    expect(dump(logs)).toContain("password change failed: write failed for [redacted]");
    expectNoPlaintext(logs);
  });

  it("redacts a leaky hasher error instead of logging the plaintext", async () => {
    const { deps, logs } = makeHarness({
      hash: () => Promise.reject(new Error(`scrypt rejected ${NEW_PASSWORD}`)),
    });
    expect(await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }))).toBe(
      503,
    );
    expect(dump(logs)).toContain("password change failed: scrypt rejected [redacted]");
    expectNoPlaintext(logs);
  });

  it("redacts a leaky users-store read error instead of logging the plaintext", async () => {
    const { deps, logs } = makeHarness({
      loadUsers: () => Promise.reject(new Error(`cannot read ${NEW_PASSWORD}`)),
    });
    expect(await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }))).toBe(
      503,
    );
    expect(dump(logs)).toContain("user store unavailable: cannot read [redacted]");
    expectNoPlaintext(logs);
  });
});

describe("safeError substring redaction (N2)", () => {
  it("N2: a short secret does not swallow unrelated operator context", async () => {
    const { deps, logs } = makeHarness({
      verify: (password) => Promise.resolve(password === "e"),
      mutateUsers: () => Promise.reject(new Error("users file is locked by another process")),
    });
    expect(await send(deps, form({ current: "e", password: NEW_PASSWORD, code: CODE }))).toBe(503);
    expect(dump(logs)).toContain("users file is locked by another process");
    expect(dump(logs)).not.toContain("[redacted]");
    expectNoPlaintext(logs);
  });

  it("N2: a long secret is replaced in place, keeping the surrounding context", async () => {
    const { deps, logs } = makeHarness({
      loadUsers: () =>
        Promise.reject(new Error(`cannot parse ${NEW_PASSWORD} while reading alice`)),
    });
    expect(await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }))).toBe(
      503,
    );
    expect(dump(logs)).toContain(
      "user store unavailable: cannot parse [redacted] while reading alice",
    );
    expectNoPlaintext(logs);
  });

  it("keeps a non-leaky store error message for operators", async () => {
    const { deps, logs } = makeHarness({
      mutateUsers: () => Promise.reject(new Error("users file is locked by another process")),
    });
    expect(await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }))).toBe(
      503,
    );
    expect(dump(logs)).toContain("users file is locked by another process");
    expectNoPlaintext(logs);
  });

  it("never passes the request body to the logger", async () => {
    const { deps, logs } = makeHarness();
    await send(deps, form({ current: CURRENT, password: NEW_PASSWORD, code: CODE }));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((entry) => typeof entry.message === "string")).toBe(true);
  });
});
