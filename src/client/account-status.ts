import { useEffect, useState } from "react";
import type { AccountStatusView, SessionKind, UserRole } from "./admin-types.ts";

/** 会话探针（只认 cookie，语义同 `/auth/status`，契约 §1.1）。 */
const STATUS_TARGET = "/auth/status";

/** 字符串字段守卫：非字符串一律 `undefined`（旧服务端/异常形状都不渲染管理块）。 */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 布尔字段守卫。 */
function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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
 * `/auth/status` 响应体 → 视图对象。**加法兼容**（契约 §1.1/§3.3）：
 * 身份字段缺失、类型不符或取值不在白名单内，一律留 `undefined`；只有
 * `authenticated === true` 才可能让调用方继续渲染登录后的 UI。
 */
function parseAccountStatus(body: unknown): AccountStatusView {
  const source = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    authenticated: source["authenticated"] === true,
    name: optionalString(source["name"]),
    role: optionalRole(source["role"]),
    disabled: optionalBoolean(source["disabled"]),
    totpEnabled: optionalBoolean(source["totpEnabled"]),
    sessionKind: optionalSessionKind(source["sessionKind"]),
  };
}

/**
 * 会话状态探针：`null` = 首次响应返回前（调用方自己渲染 loading）。
 * `credentials: "same-origin"` 保证带 cookie；卸载即 abort，回调里再看一眼 signal，
 * 避免卸载后 setState。任何失败（网络/解析/中止之外的异常）→ `{authenticated:false}`。
 */
export function useAccountStatus(): AccountStatusView | null {
  const [status, setStatus] = useState<AccountStatusView | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(STATUS_TARGET, { signal: controller.signal, credentials: "same-origin" })
      .then((res) => res.json() as Promise<unknown>)
      .then((body) => {
        if (!controller.signal.aborted) setStatus(parseAccountStatus(body));
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus({ authenticated: false });
      });
    return () => {
      controller.abort();
    };
  }, []);
  return status;
}
