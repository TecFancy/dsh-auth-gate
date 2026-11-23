/**
 * 宿主路由鉴权接线（DSH 0.2.3-alpha.2）的判定矩阵：Provider 只认**完整**会话，fallback
 * 适配器只把 `required` 在「确定放得下 Peer」时保留，其余交给守卫。
 *
 * 这里用假 `ctx` / 假 `connection` 钉住每条分支；真实 cordis + alpha.2 webserver 上的端到端
 * 行为在 `test/integration/integration.host-auth.test.ts`。
 */
import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { hasRouteAuthModel, wireHostAuth } from "./host-auth-wiring.js";
import type { HostAuthRequest } from "./host/shared/guard/index.js";
import { digestToken, SessionStore } from "./host/entities/session/index.js";
import type { Session } from "./host/entities/session/index.js";

type LogFn = (message: unknown) => void;
const noop: LogFn = () => undefined;
const log: { error: LogFn; info: LogFn; warn: LogFn } = { error: noop, info: noop, warn: noop };

/** 一张只读会话表：`getByToken` 按 sha256 摘要查，语义与真实 SessionStore 一致。 */
function storeWith(rows: Session[]): SessionStore {
  const table = new Map(rows.map((row) => [digestToken(row.subject), row]));
  return {
    getByToken: (token: string) => table.get(digestToken(token)),
  } as unknown as SessionStore;
}

function session(kind: Session["kind"] = "full"): Session {
  return {
    subject: "alice",
    createdAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60_000,
    revoked: false,
    ...(kind === undefined ? {} : { kind }),
  };
}

interface FakeHost {
  readonly ctx: Context;
  readonly providers: { authenticate(request: { headers: unknown }): unknown }[];
  readonly created: number;
  readonly disposed: number;
  /** 宿主模型是否存在（false = 旧宿主，`connection` 没有 `authentication`）。 */
  readonly newModel: boolean;
  /** 跑一次注入作用域的 disposer（插件卸载时 Cordis 做的事）。 */
  unload(): Promise<void>;
  /** 让当前 Peer 进入 aborted，模拟宿主提前释放。 */
  abortPeer(): void;
}

function fakeCtx(options: {
  newModel: boolean;
  connection?: boolean;
  sessions?: () => SessionStore | undefined;
}): FakeHost {
  const providers: { authenticate(request: { headers: unknown }): unknown }[] = [];
  const state = { created: 0, disposed: 0 };
  const disposers: (() => unknown)[] = [];
  const aborts = new Set<() => void>();
  const connection =
    options.connection === false
      ? undefined
      : {
          ...(options.newModel
            ? {
                authentication: {
                  register: (provider: (typeof providers)[number]) => {
                    providers.push(provider);
                    return () => {
                      const at = providers.indexOf(provider);
                      if (at !== -1) providers.splice(at, 1);
                      return Promise.resolve();
                    };
                  },
                },
                createPeer: () => {
                  state.created += 1;
                  const lifetime = new AbortController();
                  aborts.add(() => lifetime.abort(new Error("peer aborted by host")));
                  return {
                    id: `peer-${state.created}`,
                    signal: lifetime.signal,
                    dispose: () => {
                      state.disposed += 1;
                      return Promise.resolve();
                    },
                  };
                },
              }
            : {}),
        };
  const ctx = {
    get: (name: string) => {
      if (name === "connection") return connection;
      if (name === "connection.authentication") {
        return (connection as { authentication?: unknown } | undefined)?.authentication;
      }
      return undefined;
    },
    inject: (_names: string[], callback: (c: unknown) => void) => {
      if (connection === undefined) return;
      callback(ctx);
    },
    effect: (callback: () => unknown) => {
      const disposer = callback();
      if (typeof disposer === "function") disposers.push(disposer as () => unknown);
      return () => undefined;
    },
  } as unknown as Context;
  return {
    ctx,
    providers,
    get created() {
      return state.created;
    },
    get disposed() {
      return state.disposed;
    },
    newModel: options.newModel,
    unload: async () => {
      for (const dispose of disposers.reverse()) await dispose();
    },
    abortPeer: () => {
      for (const abort of aborts) abort();
    },
  };
}

function wiring(
  host: FakeHost,
  sessions: () => SessionStore | undefined,
  logger: typeof log = log,
) {
  return wireHostAuth(host.ctx, { sessions, cookieName: "dsh_auth", log: logger });
}

function hostRequest(headers: Record<string, string> = {}): HostAuthRequest {
  return { headers, method: "GET", url: new URL("http://127.0.0.1/"), transport: "http" };
}

describe("hasRouteAuthModel", () => {
  it("is true only when connection exposes authentication and createPeer", () => {
    expect(hasRouteAuthModel(fakeCtx({ newModel: true }).ctx)).toBe(true);
    expect(hasRouteAuthModel(fakeCtx({ newModel: false }).ctx)).toBe(false);
    expect(hasRouteAuthModel(fakeCtx({ newModel: true, connection: false }).ctx)).toBe(false);
  });
});

describe("wireHostAuth: provider", () => {
  it("admits a full session cookie with one lazily created owner peer", () => {
    const sessionStore = storeWith([session("full")]);
    const host = fakeCtx({ newModel: true });
    wiring(host, () => sessionStore);
    expect(host.providers).toHaveLength(1);
    // 懒创建：插件装载时不建 Peer，第一个被认可的请求才建（避免无会话部署常驻一个死 Peer）。
    expect(host.created).toBe(0);
    const first = host.providers[0]?.authenticate({ headers: { cookie: "dsh_auth=alice" } });
    const second = host.providers[0]?.authenticate({ headers: { cookie: "dsh_auth=alice" } });
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(host.created).toBe(1);
  });

  it("replaces a peer the host aborted instead of handing out a dead one", () => {
    const host = fakeCtx({ newModel: true });
    wiring(host, () => storeWith([session("full")]));
    const provider = host.providers[0];
    const first = provider?.authenticate({ headers: { cookie: "dsh_auth=alice" } });
    host.abortPeer();
    const second = provider?.authenticate({ headers: { cookie: "dsh_auth=alice" } });
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(host.created).toBe(2);
  });

  it("withdraws the provider and releases the peer on unload", async () => {
    const host = fakeCtx({ newModel: true });
    wiring(host, () => storeWith([session("full")]));
    host.providers[0]?.authenticate({ headers: { cookie: "dsh_auth=alice" } });
    expect(host.created).toBe(1);
    await host.unload();
    expect(host.providers).toHaveLength(0);
    expect(host.disposed).toBe(1);
  });

  it("refuses bootstrap and restricted sessions, and any unknown cookie", () => {
    const full = storeWith([session("full")]);
    const bootstrap = storeWith([session("bootstrap")]);
    const restricted = storeWith([session("password-change-only")]);
    for (const store of [bootstrap, restricted]) {
      const host = fakeCtx({ newModel: true });
      wiring(host, () => store);
      expect(
        host.providers[0]?.authenticate({ headers: { cookie: "dsh_auth=alice" } }),
      ).toBeUndefined();
    }
    const unknown = fakeCtx({ newModel: true });
    wiring(unknown, () => full);
    expect(
      unknown.providers[0]?.authenticate({ headers: { cookie: "dsh_auth=bob" } }),
    ).toBeUndefined();
    expect(unknown.providers[0]?.authenticate({ headers: {} })).toBeUndefined();
  });

  it("refuses everything when the session store is unavailable", () => {
    const host = fakeCtx({ newModel: true });
    wiring(host, () => undefined);
    expect(
      host.providers[0]?.authenticate({ headers: { cookie: "dsh_auth=alice" } }),
    ).toBeUndefined();
  });

  it("does not register on an old host", () => {
    const host = fakeCtx({ newModel: false });
    wiring(host, () => storeWith([session("full")]));
    expect(host.providers).toHaveLength(0);
    expect(host.created).toBe(0);
  });
});

describe("wireHostAuth: fallback auth adapter", () => {
  const required = () => "required" as const;

  it("keeps required for a full session so the host hands the resource a Peer", () => {
    const host = fakeCtx({ newModel: true });
    const adapter = wiring(host, () => storeWith([session("full")]));
    expect(adapter(required, hostRequest({ cookie: "dsh_auth=alice" }))).toBe("required");
  });

  it("downgrades an anonymous navigation to anonymous so the guard can redirect to login", () => {
    const host = fakeCtx({ newModel: true });
    const adapter = wiring(host, () => storeWith([session("full")]));
    expect(adapter(required, hostRequest())).toBe("anonymous");
    expect(adapter(required, hostRequest({ cookie: "dsh_auth=bogus" }))).toBe("anonymous");
    expect(adapter(required, hostRequest({ cookie: "dsh_auth=alice" }))).toBe("required");
  });

  it("keeps required whenever an Authorization header is present (fail-closed)", () => {
    const host = fakeCtx({ newModel: true });
    const adapter = wiring(host, () => undefined);
    expect(adapter(required, hostRequest({ authorization: "Bearer shared-token" }))).toBe(
      "required",
    );
  });

  it("never touches a policy the host did not declare as required", () => {
    const host = fakeCtx({ newModel: true });
    const adapter = wiring(host, () => storeWith([session("full")]));
    expect(adapter("anonymous", hostRequest())).toBe("anonymous");
    expect(adapter("deny", hostRequest())).toBe("deny");
    expect(adapter(undefined, hostRequest())).toBe("anonymous");
  });

  it("treats a throwing rule as required and warns exactly once", () => {
    const warnings: unknown[] = [];
    const host = fakeCtx({ newModel: true });
    const adapter = wiring(host, () => undefined, {
      ...log,
      warn: (message: unknown) => {
        warnings.push(message);
      },
    });
    expect(adapter(() => "anonymous", hostRequest())).toBe("anonymous");
    const thrower = () => {
      throw new Error("boom");
    };
    expect(adapter(thrower, hostRequest())).toBe("required");
    expect(adapter(thrower, hostRequest())).toBe("required");
    expect(warnings).toHaveLength(1);
  });

  it("keeps required for a cookie-carrying request before the provider is ready", () => {
    const host = fakeCtx({ newModel: false });
    // 旧宿主：Provider 永远不注册（state.ready 保持 false），带 cookie 的 required 请求按
    // required 处理 - 旧宿主根本不读 auth，这条只是把 fail-closed 语义钉住。
    const adapter = wiring(host, () => undefined);
    expect(adapter(required, hostRequest({ cookie: "dsh_auth=alice" }))).toBe("required");
    expect(adapter(required, hostRequest())).toBe("anonymous");
  });
});
