import type { Context } from "@deepseek-ai/cordis";
import {
  isBootstrapSession,
  sessionOfRequest,
  type SessionStore,
} from "./host/entities/session/index.js";
import { isRestrictedSession } from "./host/features/password/index.js";
import type {
  FallbackAuthAdapter,
  GuardRequest,
  HostAuthPolicy,
  HostAuthRequest,
  HostAuthRule,
} from "./host/shared/guard/index.js";

/** 宿主 `connection.authentication` 服务里本接线要用的最小表面（不 import 宿主包）。 */
interface HostAuthenticationLike {
  register(provider: HostAuthProvider): () => Promise<void>;
}

interface HostAuthProvider {
  authenticate(request: { readonly headers: HostAuthRequest["headers"] }): unknown;
}

interface HostPeerLike {
  /** Peer 被释放后进入 aborted（宿主据此拒绝已放行的请求）。 */
  readonly signal?: AbortSignal | undefined;
  dispose(): Promise<void>;
}

/** 路由级鉴权模型需要的 `connection` 成员（0.2.3-alpha.2 起）。 */
interface RouteAuthConnection {
  createPeer(options: { readonly principal: { readonly kind: "owner" } }): HostPeerLike;
}

export interface HostAuthWiringInput {
  readonly sessions: () => SessionStore | undefined;
  readonly cookieName: string;
  readonly log: {
    error(message: unknown): void;
    info(message: unknown): void;
    warn(message: unknown): void;
  };
}

/**
 * 宿主是否有路由级鉴权模型（`connection` + 独立服务 `connection.authentication`）。
 *
 * 两处细节都来自实测：Cordis 4.2 的服务代理**禁止**读取未注入的嵌套服务成员
 * （`connection.authentication` 会抛 `cannot get property … without inject`），所以判断只能
 * 用 `ctx.get` 逐个取，并且整体 try/catch（旧宿主上这两个服务不存在或形状不同都返回 false）。
 */
export function hasRouteAuthModel(ctx: Context): boolean {
  try {
    const connection = ctx.get("connection") as unknown as { createPeer?: unknown } | undefined;
    const authentication = ctx.get("connection.authentication") as unknown as
      { register?: unknown } | undefined;
    return (
      typeof connection?.createPeer === "function" && typeof authentication?.register === "function"
    );
  } catch {
    return false;
  }
}

/**
 * 把本插件的完整会话接成宿主 `connection.authentication` 的 Provider，并给出 fallback 鉴权适配器。
 *
 * 背景（DSH 0.2.3-alpha.2）：宿主在**路由分发之前**按路由 `auth` 策略判定；省略 `auth` 即
 * `required`。插件自己的门包在 handler/resource 外面，请求被宿主判死时根本到不了那里。这里注册
 * 一个 Provider：请求带本插件**完整**会话（cookie 或 Bearer 会话 token）→ 返回 owner Peer，
 * 宿主 required 路由放行；否则 `undefined`，宿主自己的 Token/Remote Provider 继续尝试。
 *
 * 注册走 `ctx.inject(["connection"])`：宿主组合里 `connection` 可能晚于本插件就绪，apply 时
 * 直接 `ctx.get` 会永远拿不到。旧宿主（`connection` 在但没有 `authentication` 子服务）注入
 * 回调直接返回，Provider 不装，行为与 0.2.2 及更早一致。
 *
 * Peer 的粒度为 owner：宿主侧权限只区分「已放行/未放行」，而本插件对所有完整会话一视同仁
 * （角色只在插件自己的管理面里细分），与旧宿主守卫放行后的语义相同。Peer 由读 `connection`
 * 的那层 ctx 拥有，插件卸载时随之释放；bootstrap 与受限会话**不**算完整会话，换不到 Peer，
 * 因而不会因为宿主放行而拿到数据面权限。
 */
export function wireHostAuth(ctx: Context, input: HostAuthWiringInput): FallbackAuthAdapter {
  const state = { ready: false };
  // 极简 ctx（部分单测夹具、或非 Cordis 的宿主）没有 `inject`：Provider 不装，适配器照常返回
  // - 它只在宿主真的按路由策略判定时才被调用，旧宿主不会读到这个字段。
  if (typeof ctx.inject !== "function") return makeFallbackAuth(input, state);
  ctx.inject(["connection", "connection.authentication"], (connectionCtx) => {
    // 两个服务都要显式注入：Cordis 4.2 的服务代理拒绝读取未注入的嵌套服务成员。
    const connection = connectionCtx.get("connection") as unknown as
      { createPeer?: RouteAuthConnection["createPeer"] } | undefined;
    const authentication = connectionCtx.get("connection.authentication") as unknown as
      HostAuthenticationLike | undefined;
    if (
      typeof connection?.createPeer !== "function" ||
      typeof authentication?.register !== "function"
    ) {
      // 有 connection 却不是这套契约：说明宿主既不是旧模型（没有这个子服务）也不是我们验证过
      // 的新模型。大声失败（security.md §1：绝不静默降级），不装 Provider。
      input.log.error(
        "host route authentication unavailable: connection exposes neither the documented " +
          "authentication registry nor createPeer; only the plugin gate is enforcing access",
      );
      return;
    }
    const createPeer: (options: { principal: { kind: "owner" } }) => HostPeerLike =
      connection.createPeer.bind(connection);
    const peerState = new PeerHandles(createPeer, input);
    connectionCtx.effect(() => () => peerState.disposeAll(), "dsh-auth-gate: host auth peer");
    const provider: HostAuthProvider = {
      authenticate: (request) =>
        ownsFullSession(input, request.headers) ? peerState.current() : undefined,
    };
    connectionCtx.effect(() => {
      // 宿主契约（dsh-client-connection d.ts）是 `register` 返回 `() => Promise<void>`；两种返回
      // 形态都接住，避免异步注册表上把 disposer 当 Promise 丢掉。
      const registered = authentication.register(provider) as unknown;
      return async () => {
        const dispose =
          typeof registered === "function"
            ? (registered as () => Promise<void>)
            : await (registered as Promise<() => Promise<void>>);
        await Promise.resolve(dispose()).catch(() => undefined);
      };
    }, "dsh-auth-gate: host auth provider");
    state.ready = true;
    input.log.info("host route authentication: full sessions are admitted as owner peers");
  });
  return makeFallbackAuth(input, state);
}

/**
 * 宿主的 owner Peer，按需创建并持有：Peer 只会随插件卸载释放，但宿主可能提前把它 abort
 * （例如 connection 自己重载）。`current()` 发现已 abort 就换一个新的，绝不把死 Peer 交给宿主
 * - 宿主对 `admission.peer.signal.aborted` 的答复是 401，那会让所有已登录用户静默失联。
 */
class PeerHandles {
  private readonly create: () => HostPeerLike;
  private readonly input: HostAuthWiringInput;
  private peer: HostPeerLike | undefined;

  constructor(
    createPeer: (options: { principal: { kind: "owner" } }) => HostPeerLike,
    input: HostAuthWiringInput,
  ) {
    this.create = () => createPeer({ principal: { kind: "owner" } });
    this.input = input;
  }

  /** 当前可用 Peer；已 abort 或尚未创建时重建。创建失败记 error 并返回 undefined（fail-closed）。 */
  current(): HostPeerLike | undefined {
    if (this.peer?.signal?.aborted === true) {
      this.input.log.error("host auth peer was aborted; creating a replacement peer");
      this.peer = undefined;
    }
    if (this.peer !== undefined) return this.peer;
    try {
      this.peer = this.create();
      return this.peer;
    } catch (error) {
      this.input.log.error(
        `host auth peer could not be created: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** 释放持有的 Peer；释放失败按已释放处理（插件正在卸载，没有可回退的动作）。 */
  async disposeAll(): Promise<void> {
    const peer = this.peer;
    this.peer = undefined;
    await peer?.dispose().catch(() => undefined);
  }
}

/** 请求是否带着本插件的**完整**会话（bootstrap / 受限会话不算）。 */
function ownsFullSession(input: HostAuthWiringInput, headers: HostAuthRequest["headers"]): boolean {
  const session = sessionOfRequest(
    { headers: toGuardHeaders(headers) },
    input.cookieName,
    input.sessions(),
  );
  if (session === undefined || isBootstrapSession(session)) return false;
  return !isRestrictedSession(session);
}

/**
 * fallback 鉴权适配器：宿主原规则只在 `required` 时被改写。
 *
 * - 有 `Authorization` 头 → 保持 `required`：不把可能的 API 凭证当匿名导航放行（fail-closed），
 *   也避免宿主在 `peer === undefined` 时渲染索引（新版 frontend-static 会读 `peer.signal`）。
 * - 有完整会话 → `required`：宿主才会把 Peer 交给 resource（索引渲染需要它）。
 * - 其余 → `anonymous`：宿主放行，由守卫按登录流程给出 302/401（拿不到 Peer 的索引渲染会被
 *   守卫拦在门外，不会落进宿主的 resource）。
 * - 原规则是函数时先按请求求值；求值抛错按 `required` 处理（fail-closed）。
 * - Provider 尚未就绪（宿主 `connection` 晚到，或本插件还没注入完成）而请求又带着会话 cookie
 *   时按 `required`：宁可让宿主回 401，也不要「门放行、宿主渲染索引却拿不到 Peer」而崩。
 */
function makeFallbackAuth(
  input: HostAuthWiringInput,
  state: { ready: boolean },
): FallbackAuthAdapter {
  let warnedRule = false;
  return (original, request) => {
    const policy = resolvePolicy(original, request, () => {
      if (warnedRule) return;
      warnedRule = true;
      input.log.warn(
        "host fallback auth rule threw; treating the route as required (fail-closed). " +
          "The route's own rule never ran, so its intent is unknown",
      );
    });
    // 原规则自己抛错：无法判断它是想放行还是拒绝，按 required 定死（fail-closed，不再降级）。
    if (policy === "error") return "required";
    if (policy !== "required") return policy;
    const headers = toGuardHeaders(request.headers);
    if (headers.authorization !== undefined) return "required";
    if (ownsFullSession(input, request.headers)) return "required";
    const carriesCookie = headers.cookie !== undefined && headers.cookie !== "";
    return !carriesCookie || state.ready ? "anonymous" : "required";
  };
}

/**
 * 求出宿主原规则对这次请求的策略；缺省 `required` 与宿主一致。抛错交给 `onError` 记一次
 * 告警（每次接线只记一次，避免请求驱动的日志洪水），并按 `error` 标记让调用方定死 required。
 */
function resolvePolicy(
  rule: HostAuthRule | undefined,
  request: HostAuthRequest,
  onError: () => void,
): HostAuthPolicy | "error" {
  if (rule === undefined) return "required";
  if (typeof rule !== "function") return rule;
  try {
    return rule(request);
  } catch {
    onError();
    return "error";
  }
}

/** 把宿主 `Headers` 或普通头表统一成门读取的可变普通对象（多值头逐项复制）。 */
function toGuardHeaders(headers: HostAuthRequest["headers"]): GuardRequest["headers"] {
  const record: GuardRequest["headers"] = {};
  if (headers instanceof Headers) {
    for (const [name, value] of headers.entries()) record[name] = value;
    return record;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    record[name] = typeof value === "string" ? value : [...value];
  }
  return record;
}
