import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "../../gate/index.js";
import {
  LoginRateLimiter,
  makeClientIpResolver,
  parseClientIpPolicy,
  type ClientIpResolver,
} from "../../shared/index.js";
import type { SessionStore } from "../../session/index.js";
import { registerPasswordEndpoints, type PasswordEndpointsDeps } from "./password-endpoints.js";

interface FakeRes {
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

function makeRes(): { res: ServerResponse; state: FakeRes } {
  const state: FakeRes = { status: undefined, headers: {}, body: "" };
  const res = {
    setHeader: (name: string, value: string): void => {
      state.headers[name.toLowerCase()] = String(value);
    },
    writeHead: (status: number, extra?: Record<string, string | number>): void => {
      state.status = status;
      for (const [name, value] of Object.entries(extra ?? {})) {
        state.headers[name.toLowerCase()] = String(value);
      }
    },
    end: (body?: string): void => {
      state.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return { res, state };
}

function loginReq(
  body: string,
  headers: Record<string, string>,
  remoteAddress: string,
): IncomingMessage {
  return {
    method: "POST",
    url: "/auth/login",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    socket: { remoteAddress },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      yield Buffer.from(body);
    },
  } as unknown as IncomingMessage;
}

interface Harness {
  /** 返回响应状态：401 凭证错 / 429 限速 / 302 登录成功。 */
  post(body: string, headers: Record<string, string>, remoteAddress?: string): Promise<number>;
}

function makeHarness(clientIp?: ClientIpResolver): Harness {
  const routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[] = [];
  const limiter = new LoginRateLimiter({ now: () => 1_000_000 });
  const users = new Map([
    ["alice", { passwordHash: "h-alice", disabled: false }],
    ["bob", { passwordHash: "h-bob", disabled: false }],
  ]);
  const deps: PasswordEndpointsDeps = {
    register: (route) => {
      routes.push(route);
      return () => undefined;
    },
    sessions: () =>
      ({
        create: (subject: string) =>
          Promise.resolve({
            token: "fake-token",
            session: { subject, createdAt: 0, expiresAt: 0, revoked: false },
          }),
      }) as unknown as SessionStore,
    cookieName: "dsh_auth",
    cookieSecure: false,
    sessionTtl: 604800,
    logoutOrder: 1000,
    usersPath: "/tmp/users.yaml",
    loadUsers: () => Promise.resolve({ snapshot: { users }, missing: false }),
    verify: (password, storedHash) =>
      Promise.resolve(password === "pw" && storedHash.startsWith("h-")),
    totpMode: "off",
    verifyTotp: () => undefined,
    replayCheck: () => true,
    now: () => 1_700_000_000_000,
    challengeMacKey: Buffer.alloc(32, 7),
    limiter,
    ...(clientIp === undefined ? {} : { clientIp }),
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
  };
  registerPasswordEndpoints(deps);
  const route = routes.find((entry) => entry.path === "/auth/login");
  if (route === undefined) throw new Error("login route not registered");
  return {
    post: async (body, headers, remoteAddress = "127.0.0.1") => {
      const { res, state } = makeRes();
      await route.handler(loginReq(body, headers, remoteAddress), res);
      return state.status ?? 0;
    },
  };
}

/** 反代拓扑的 harness：读 `cf-connecting-ip`，默认只信回环。 */
const proxyHarness = (): Harness =>
  makeHarness(makeClientIpResolver(parseClientIpPolicy("cf-connecting-ip", undefined)));

const wrongAlice = "username=alice&password=nope";
const rightBob = "username=bob&password=pw";

async function failFiveTimes(
  harness: Harness,
  headers: Record<string, string>,
  remoteAddress: string,
): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    expect(await harness.post(wrongAlice, headers, remoteAddress)).toBe(401);
  }
}

describe("POST /auth/login: client identity behind a reverse proxy (issue #74)", () => {
  it("locks every client out when no client IP header is configured", async () => {
    const harness = makeHarness();
    await failFiveTimes(harness, {}, "127.0.0.1");
    // 同一反代后的另一台设备、另一个账号：自己的桶与账号桶都干净，仍被 429（上报的缺陷）
    expect(await harness.post(rightBob, {}, "127.0.0.1")).toBe(429);
  });

  it("keeps two devices of the same reverse proxy in separate buckets", async () => {
    const harness = proxyHarness();
    await failFiveTimes(harness, { "cf-connecting-ip": "203.0.113.7" }, "127.0.0.1");
    expect(await harness.post(rightBob, { "cf-connecting-ip": "198.51.100.4" }, "127.0.0.1")).toBe(
      302,
    );
    // 出事的那台设备自己仍被锁（IP 桶 + 账号桶都在），账号级保护没有被放宽
    expect(await harness.post(rightBob, { "cf-connecting-ip": "203.0.113.7" }, "127.0.0.1")).toBe(
      429,
    );
    expect(
      await harness.post(
        "username=alice&password=pw",
        { "cf-connecting-ip": "198.51.100.4" },
        "127.0.0.1",
      ),
    ).toBe(429);
  });

  it("ignores a forged header when the peer is not a trusted proxy", async () => {
    const harness = proxyHarness();
    await failFiveTimes(harness, { "cf-connecting-ip": "1.2.3.4" }, "203.0.113.9");
    // 换个伪造值仍是同一个 peer 桶：头根本没被读
    expect(await harness.post(rightBob, { "cf-connecting-ip": "9.9.9.9" }, "203.0.113.9")).toBe(
      429,
    );
    // 另一个直连 peer 有自己的桶
    expect(await harness.post(rightBob, { "cf-connecting-ip": "1.2.3.4" }, "203.0.113.10")).toBe(
      302,
    );
  });

  it("falls back to the peer when the trusted proxy sends no header", async () => {
    const harness = proxyHarness();
    await failFiveTimes(harness, {}, "127.0.0.1");
    expect(await harness.post(rightBob, {}, "127.0.0.1")).toBe(429);
  });
});
