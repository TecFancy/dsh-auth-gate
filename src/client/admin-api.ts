import { describeAdminFailure } from "./admin-failure.ts";
import { ADMIN_KEYS, type AdminTranslate } from "./admin-copy.ts";
import type {
  AdminFailureView,
  AdminResetResult,
  AdminResetValues,
  AdminUserRow,
  AdminUsersResult,
} from "./admin-types.ts";

/**
 * 管理面客户端 API（CONTRACT-pr2 §1.2 / §1.3 + §9）：列表读取 + 重置提交。
 *
 * 类型全部来自 `admin-types.ts`（冻结面）；失败映射在 `admin-failure.ts`（A12 预拆，此处按
 * 冻结面原样再导出）。不手写 `Origin`（同源 POST 由浏览器自动携带）、不做 `Accept` 子串匹配、
 * 不重排服务端已排好的顺序。
 */

export { describeAdminFailure };

const USERS_TARGET = "/auth/users";
const RESET_TARGET = "/auth/users/password";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 单行形状校验：任一必需字段类型不符即丢弃该行（不整表失败，契约 §1.2）。 */
function asRow(value: unknown): AdminUserRow | undefined {
  if (!isRecord(value)) return undefined;
  const name = value["name"];
  const role = value["role"];
  const disabled = value["disabled"];
  const totpEnabled = value["totpEnabled"];
  const mustChangePassword = value["mustChangePassword"];
  if (typeof name !== "string" || name === "") return undefined;
  if (role !== "admin" && role !== "user") return undefined;
  if (typeof disabled !== "boolean" || typeof totpEnabled !== "boolean") return undefined;
  if (typeof mustChangePassword !== "boolean") return undefined;
  return { name, role, disabled, totpEnabled, mustChangePassword };
}

/** 解析 200 body；`users` 不是数组视为形状非法（整表 failure）。 */
function parseUsers(body: unknown): AdminUserRow[] | undefined {
  if (!isRecord(body)) return undefined;
  const raw = body["users"];
  if (!Array.isArray(raw)) return undefined;
  // 保持服务端顺序：只过滤，不排序。
  return raw.map(asRow).filter((row): row is AdminUserRow => row !== undefined);
}

/** 读 JSON；非对象或解析失败统一回空体（映射只看状态码）。 */
async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

/**
 * `GET /auth/users`（cookie only，无 Origin 要求）。
 * 403 → `denied`（静默降级）；401 → `unauthorized`（整页登录态已死，必须提示，§9/A2）；
 * 非 200 / 形状非法 / 网络抛错 → `failure`；中止 → `aborted`（abort 后不解析响应体）。
 */
export async function fetchAdminUsers(signal: AbortSignal): Promise<AdminUsersResult> {
  try {
    const res = await fetch(USERS_TARGET, { method: "GET", signal, credentials: "same-origin" });
    if (signal.aborted) return { kind: "aborted" };
    if (res.status === 403) return { kind: "denied" };
    if (res.status === 401) return { kind: "unauthorized" };
    if (!res.ok) return { kind: "failure" };
    const body: unknown = await res.json();
    if (signal.aborted) return { kind: "aborted" };
    const users = parseUsers(body);
    return users === undefined ? { kind: "failure" } : { kind: "ok", users };
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
  }
}

/**
 * 本地校验闭表（§9/A6）：target → password → confirm → code。
 * `code` 只在 `actorTotpEnabled === true` 时校验，且用 `trim()` 判空（口令字段不 trim）。
 * 第三个参数缺省 false，只传两个实参的调用方行为不变。
 */
export function validateAdminReset(
  values: AdminResetValues,
  t: AdminTranslate,
  actorTotpEnabled = false,
): AdminFailureView | null {
  if (values.target === "") {
    return { message: t(ADMIN_KEYS.targetRequired), rules: [], fields: ["target"] };
  }
  if (values.password === "") {
    return { message: t(ADMIN_KEYS.passwordRequired), rules: [], fields: ["password"] };
  }
  if (values.password !== values.confirm) {
    return { message: t(ADMIN_KEYS.mismatch), rules: [], fields: ["password", "confirm"] };
  }
  if (actorTotpEnabled && values.code.trim() === "") {
    return { message: t(ADMIN_KEYS.codeRequired), rules: [], fields: ["code"] };
  }
  return null;
}

/**
 * 提交请求体（§9/A3）：只发 `target` / `password`，`actorTotpEnabled === true` 时才带 `code`
 * （缺码场景不发空串）；**`confirm` 永不发送**。
 */
function postAdminReset(
  values: AdminResetValues,
  options: { signal: AbortSignal; actorTotpEnabled: boolean },
): Promise<Response> {
  const body = new URLSearchParams();
  body.set("target", values.target);
  body.set("password", values.password);
  if (options.actorTotpEnabled) body.set("code", values.code);
  return fetch(RESET_TARGET, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: options.signal,
    credentials: "same-origin",
  });
}

/**
 * `POST /auth/users/password`：
 * **成功只认契约 §1.3 的唯一形状** `200 {ok:true}`（grok 实现期必修 1）：2xx 但缺 `ok:true`
 * （空 JSON、`{ok:false}`、中间层 HTML 拦截页）一律走失败映射，宁可报错也不谎报"已重置"
 * 再清空现场口令。`sessionsRevoked` 缺失/非布尔/解析失败按 `false`（§9/A8+A10）；
 * 中止 → `aborted`。
 */
export async function submitAdminReset(
  values: AdminResetValues,
  options: { signal: AbortSignal; actorTotpEnabled: boolean },
  t: AdminTranslate,
): Promise<AdminResetResult> {
  try {
    const res = await postAdminReset(values, options);
    if (options.signal.aborted) return { kind: "aborted" };
    const body = await readJsonSafe(res);
    if (options.signal.aborted) return { kind: "aborted" };
    if (res.status === 200 && body["ok"] === true) {
      return { kind: "ok", sessionsRevoked: body["sessionsRevoked"] === true };
    }
    return { kind: "failure", failure: describeAdminFailure(res.status, body, t) };
  } catch {
    if (options.signal.aborted) return { kind: "aborted" };
    return {
      kind: "failure",
      failure: { message: t(ADMIN_KEYS.generic), rules: [], fields: [] },
    };
  }
}
