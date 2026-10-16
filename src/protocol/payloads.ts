/**
 * 跨半边契约（D31）的载荷半边：`/auth/*` 端点的请求体、响应体与错误体形状。
 *
 * 只放纯类型（编译后整个文件消失），不 import 任何东西。host 写出与解析、client 发送与解析
 * 都以这里为准：host 的写出点按这些类型收窄（写错键或错误码编译不过），client 的解析器按
 * `Unchecked<T>` 读键（读错键编译不过）。运行期仍由 client 逐字段校验，类型不替代校验。
 *
 * 改这里就是改对外契约：已部署的旧 client 只认旧形状，响应只能加法演进。
 */

/** 用户角色（`users.yaml` 的 `role`，也是 `/auth/status` 与 `/auth/users` 里的 `role`）。 */
export type UserRole = "user" | "admin";

/** 会话类别（D25）：受限会话只能改密，不进管理面。 */
export type SessionKind = "full" | "password-change-only";

/** 口令策略未通过项（值即 400 `policy` 错误体里 `rules` 数组的元素，顺序同 host 判定顺序）。 */
export type PasswordRule =
  "minLength" | "maxLength" | "uppercase" | "lowercase" | "digit" | "special" | "sameAsOld";

/**
 * 把一个线上形状变成「刚从 JSON 读进来」的样子：键集合不变（含联合各成员的全部键），值一律
 * `unknown`、一律可缺。client 解析器拿它读字段，键名受契约约束，值仍要逐个校验。
 */
export type Unchecked<T> = Partial<Record<T extends unknown ? keyof T : never, unknown>>;

/**
 * `GET /auth/status` 的 200 响应体。
 *
 * `authenticated` 与 `logoutOrder` 恒在。身份字段只在 password 模式、会话有效且账号仍在
 * `users.yaml` 时出现，否则整组缺席（不出现 `null` 占位，不泄漏账号是否存在）。
 * 可选字段显式带 `| undefined`（`exactOptionalPropertyTypes`），JSON 里缺席与 `undefined` 等价。
 */
export interface StatusResponse {
  authenticated: boolean;
  /** 「退出登录」按钮在通用设置页的槽位 order（host 配置透传）。 */
  logoutOrder: number;
  name?: string | undefined;
  role?: UserRole | undefined;
  disabled?: boolean | undefined;
  totpEnabled?: boolean | undefined;
  mustChangePassword?: boolean | undefined;
  sessionKind?: SessionKind | undefined;
}

/**
 * `GET /auth/users` 列表的一行：只含关于用户的公开字段，键集合恒定。
 * 绝不含哈希、盐、scrypt 参数、`totpSecret`、会话数或最近登录时间。
 */
export interface AdminUserRow {
  name: string;
  role: UserRole;
  disabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

/** `GET /auth/users` 的 200 响应体（按 `name` 排好序，client 不重排）。 */
export interface UsersResponse {
  users: AdminUserRow[];
}

/** `GET /auth/users` 的 JSON 错误体：401 无会话、403 非 admin / 已禁用 / 受限会话。 */
export interface UsersErrorBody {
  error: "unauthorized" | "forbidden";
}

/** 400 `policy`：新口令未过策略，`rules` 列出未通过项。 */
export interface PolicyErrorBody {
  error: "policy";
  rules: PasswordRule[];
}

/** 429 `locked`：限速桶已锁，`retryAfter` 是秒数（同时写 `retry-after` 头）。 */
export interface LockedErrorBody {
  error: "locked";
  retryAfter: number;
}

/**
 * `POST /auth/password` 的请求体（`application/x-www-form-urlencoded` 字段）。
 * 口令按原始码点传，不 trim；两次输入一致只在 client 比对，`confirm` 不进请求体。
 */
export interface PasswordChangeRequest {
  current: string;
  password: string;
  /** TOTP 验证码；未启用时 client 也发空串。 */
  code: string;
  /** 只有 SSR 无 JS 表单带 `"1"`：成功后 302 回登录页，而不是 200 JSON。 */
  nav?: "1";
}

/** `POST /auth/password` 的 200 响应体（client 只看状态码）。 */
export interface PasswordChangeResponse {
  ok: true;
}

/**
 * `POST /auth/password` 的 JSON 错误体：401 `unauthorized`（无会话）/ `invalid_credentials` /
 * `invalid_totp`，403 `bad_origin`，400 `policy`，429 `locked`。
 * 413 / 415 / 503 是 `text/plain`，不在这里。
 */
export type PasswordChangeErrorBody =
  | { error: "unauthorized" | "invalid_credentials" | "invalid_totp" | "bad_origin" }
  | PolicyErrorBody
  | LockedErrorBody;

/**
 * `POST /auth/users/password` 的请求体（`application/x-www-form-urlencoded` 字段）。
 * `target` 只认 body；`confirm` 只在 client 比对，不进请求体。
 */
export interface AdminResetRequest {
  target: string;
  password: string;
  /** 只在 actor 自己启用了 TOTP 时发送（缺码不发空串）；未启用时 host 忽略它。 */
  code?: string;
}

/** `POST /auth/users/password` 的 200 响应体：`sessionsRevoked:false` 仍是成功（写盘已完成）。 */
export interface AdminResetResponse {
  ok: true;
  sessionsRevoked: boolean;
}

/**
 * `POST /auth/users/password` 的 JSON 错误体：401 `unauthorized` / `invalid_totp`，
 * 403 `forbidden`（含误把自己当目标），400 `bad_target` / `policy`，404 `not_found`，
 * 429 `locked`。413 / 415 / 503 是 `text/plain`，不在这里。
 */
export type AdminResetErrorBody =
  | { error: "unauthorized" | "forbidden" | "bad_target" | "not_found" | "invalid_totp" }
  | PolicyErrorBody
  | LockedErrorBody;
