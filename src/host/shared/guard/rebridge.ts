import type { GuardKind, GuardRequest } from "./gate.js";
import { isSafeLocation } from "./http.js";

/**
 * 一次重铸询问的结论：302 到 `location`，并可选地随这次 302 下发 cookie。
 *
 * `setCookie` 用来放一次性标记（见 `src/rebridge-wiring.ts`）：标记必须在**重定向响应**上
 * 下发，而钩子只返回数据、不碰响应，所以由守卫代写。
 */
export interface RebridgeDecision {
  /** 站内相对 Location；守卫写出前还会用 `isSafeLocation` 再消毒一次。 */
  readonly location: string;
  /** 随 302 一起下发的 `Set-Cookie` 值（一条，已含全部属性）。 */
  readonly setCookie?: string | undefined;
}

/**
 * 放行后重铸钩子：门给出 `allow` 之后、守卫调用原入口之前询问一次，回答「这次请求要不要先
 * 重铸宿主自己的浏览器 cookie」。
 *
 * 返回结论表示守卫应 302 到它、**不**调用原入口；返回 `undefined` 表示照常放行。只在 HTTP
 * 入口（handler 与 resource）询问，WS 升级不问：握手没法用重定向修复。
 *
 * 实现必须自己吞掉所有异常：守卫不 try/catch，钩子抛错会变成一次放行请求的失败。钩子也
 * 必须同步返回，因为它在响应写出之前、原入口调用之前占着这次请求。
 */
export type AdmitRebridge = (
  req: GuardRequest,
  kind: GuardKind,
  pathname: string,
) => RebridgeDecision | undefined;

/**
 * 询问重铸钩子并消毒它给出的 Location。
 *
 * 钩子缺失、抛错、或给出站外/带控制符的地址时一律返回 `undefined`（照常放行）：门已经
 * 放行过这次请求，重铸只是补救通道，它坏掉不该把一次合法请求变成错误。消毒放在这里而不是
 * 交给 `denyReply`，是因为后者的兜底是登录页-把已认证用户送去登录页比不重铸更糟。
 */
export function rebridgeDecision(
  rebridge: AdmitRebridge | undefined,
  req: GuardRequest,
  kind: GuardKind,
  pathname: string,
): RebridgeDecision | undefined {
  if (rebridge === undefined) return undefined;
  try {
    const decision = rebridge(req, kind, pathname);
    if (decision === undefined) return undefined;
    return isSafeLocation(decision.location) ? decision : undefined;
  } catch {
    return undefined;
  }
}
