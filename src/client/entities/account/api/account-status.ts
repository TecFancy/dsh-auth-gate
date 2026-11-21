import { useEffect, useState } from "react";
import {
  isRecord,
  readJsonSafe,
  STATUS_PATH,
  type SessionKind,
  type StatusResponse,
  type Unchecked,
  type UserRole,
} from "../../../shared/api/index.ts";

/**
 * `GET /auth/status` 的「关于我」视图：线上形状 `StatusResponse`（跨半边契约 D31）去掉本视图
 * 不消费的 `mustChangePassword`。
 *
 * **加法兼容**：身份字段是 PR1 才有的（旧服务端只回 `authenticated`/`logoutOrder`），
 * 任一身份字段缺失即视为「不渲染管理块」，其余行为一字不变（契约 §1.1 / §3.3）。
 * `passkeyEnabled` 线上恒在（配置透传），但旧服务端没有它：视图里因此是可选的，
 * 缺失即 `undefined`（「不知道」，调用方不得据此推断关闭）。
 */
export type AccountStatusView = Omit<
  StatusResponse,
  "logoutOrder" | "mustChangePassword" | "passkeyEnabled" | "passwordLoginDisabled"
> & {
  /** 「退出登录」按钮的槽位 order；缺失/非整数为 `undefined`（入口保留默认值）。 */
  logoutOrder?: number | undefined;
  passkeyEnabled?: boolean | undefined;
  /** 口令登录是否被策略关闭（`passkey: "required"`）；旧服务端缺该键 → `undefined`。 */
  passwordLoginDisabled?: boolean | undefined;
};

/** 会话探针结果：`ok`（200 体，含未认证）/ `failure`（网络、5xx、非 JSON）/ `aborted`。 */
export type AccountStatusResult =
  { kind: "ok"; status: AccountStatusView } | { kind: "failure" } | { kind: "aborted" };

/** hook 的状态：首次响应前 loading；探针失败是**独立**的 failure，不塌缩成「未登录」。 */
export type AccountStatusState =
  { kind: "loading" } | { kind: "ok"; status: AccountStatusView } | { kind: "failure" };

/** 字符串字段守卫：非字符串一律 `undefined`（旧服务端/异常形状都不渲染管理块）。 */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 布尔字段守卫。 */
function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** 整数字段守卫（槽位 order 必须是整数；非整数/缺失都退回 `undefined`）。 */
function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/** role 白名单：只认 `admin` / `user`，其余（含非法字符串）留 `undefined`。 */
function optionalRole(value: unknown): UserRole | undefined {
  return value === "admin" || value === "user" ? value : undefined;
}

/** sessionKind 白名单：只认 `full` / `password-change-only`。 */
function optionalSessionKind(value: unknown): SessionKind | undefined {
  return value === "full" || value === "password-change-only" ? value : undefined;
}

/**
 * `/auth/status` 响应体 → 视图对象。**逐字段白名单解析**（C8）：身份字段缺失、类型不符或
 * 取值不在白名单内，一律留 `undefined`；只有 `authenticated === true` 才可能让调用方继续渲染
 * 登录后的 UI。`passkeyEnabled` 同理：旧服务端没有该键、或值不是布尔 → `undefined`（不推断关闭）。
 */
export function parseAccountStatus(body: unknown): AccountStatusView {
  const source: Unchecked<StatusResponse> = isRecord<StatusResponse>(body) ? body : {};
  return {
    authenticated: source.authenticated === true,
    logoutOrder: optionalInteger(source.logoutOrder),
    passkeyEnabled: optionalBoolean(source.passkeyEnabled),
    passwordLoginDisabled: optionalBoolean(source.passwordLoginDisabled),
    name: optionalString(source.name),
    role: optionalRole(source.role),
    disabled: optionalBoolean(source.disabled),
    totpEnabled: optionalBoolean(source.totpEnabled),
    sessionKind: optionalSessionKind(source.sessionKind),
  };
}

/** 一次在飞的探针请求；多个消费方共享同一个 promise。 */
interface ProbeFlight {
  controller: AbortController;
  promise: Promise<AccountStatusResult>;
  subscribers: number;
}

let flight: ProbeFlight | null = null;

/** 发一次真实的探针请求；永远 resolve（失败映射成 `failure`），不抛给消费方。 */
async function probe(signal: AbortSignal): Promise<AccountStatusResult> {
  try {
    const res = await fetch(STATUS_PATH, { signal, credentials: "same-origin" });
    if (signal.aborted) return { kind: "aborted" };
    // 401 = 会话没了，等同「未认证」（host 的正常路径是 200 + authenticated:false）；
    // 网络/5xx/非 JSON 才是探针失败，绝不能塌缩成「请先登录」（C9）。
    if (res.status === 401) return { kind: "ok", status: parseAccountStatus({}) };
    if (!res.ok) return { kind: "failure" };
    const body = await readJsonSafe(res);
    if (signal.aborted) return { kind: "aborted" };
    return { kind: "ok", status: parseAccountStatus(body) };
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
  }
}

/** 每个消费方都带自己的 signal；最后一个退订者负责 abort 底层请求。 */
function subscribe(
  current: ProbeFlight,
  signal: AbortSignal | undefined,
): Promise<AccountStatusResult> {
  current.subscribers += 1;
  return new Promise<AccountStatusResult>((resolve) => {
    let settled = false;
    const settle = (result: AccountStatusResult): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      current.subscribers -= 1;
      if (current.subscribers === 0) {
        if (flight === current) flight = null;
        // 没有消费者还在等：别让一个迟到的响应拖住下一个探针。
        current.controller.abort();
      }
      resolve(result);
    };
    const onAbort = (): void => settle({ kind: "aborted" });
    signal?.addEventListener("abort", onAbort, { once: true });
    current.promise.then(settle, () => settle({ kind: "failure" }));
  });
}

/**
 * 共享的 `/auth/status` 探针（C9）：插件入口的 logout-order 探针、账户区状态 hook 与登出按钮
 * 在**同一次页面加载**里只发一个请求；每个调用方的 signal 只退订自己（最后一个退订才 abort）。
 */
export function requestAccountStatus(signal?: AbortSignal): Promise<AccountStatusResult> {
  if (signal?.aborted === true) return Promise.resolve({ kind: "aborted" });
  flight ??= (() => {
    const controller = new AbortController();
    return { controller, promise: probe(controller.signal), subscribers: 0 };
  })();
  return subscribe(flight, signal);
}

/** 会话状态探针：挂载/重试时经共享探针读一次；卸载即退订（不会卸载后 setState）。 */
export function useAccountStatus(): { state: AccountStatusState; retry: () => void } {
  const [state, setState] = useState<AccountStatusState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void requestAccountStatus(controller.signal).then((result) => {
      if (!live || result.kind === "aborted") return;
      setState(result.kind === "ok" ? { kind: "ok", status: result.status } : { kind: "failure" });
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);
  return { state, retry: () => setAttempt((value) => value + 1) };
}
