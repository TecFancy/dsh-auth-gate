/**
 * 未校验 JSON 的读取小件：client 各 API 解析器共用。
 *
 * 跨半边契约（D31）的类型只约束键名与响应形状，值仍然逐个字段白名单校验：
 * 类型不替代校验，`as` 也不替代校验。
 */
import type { Unchecked } from "./protocol.ts";

/** 对象守卫：收窄成普通记录（读键走括号，值仍是 `unknown`）。 */
export function isRecord(value: unknown): value is Record<string, unknown>;
/** 对象守卫（契约形状）：键名受跨半边契约约束，值仍是未校验的 `unknown`。 */
export function isRecord<T>(value: unknown): value is Unchecked<T>;
export function isRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * 读 JSON；解析失败返回 `undefined`（调用方按状态码兜底，不把「不是 JSON」当合法体）。
 *
 * 返回 `unknown` 是刻意的：调用方必须先收窄再逐字段校验，拿不到「键存在即合法」的假保证。
 */
export async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    const body: unknown = await res.json();
    return body;
  } catch {
    return undefined;
  }
}
