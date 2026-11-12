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

/**
 * 会话类别（D25）：受限会话只能改密，不进管理面；bootstrap 会话只能访问本插件的
 * `/auth/*`，只在首次引导通道签发，向导完成后整体吊销。
 */
export type SessionKind = "full" | "password-change-only" | "bootstrap";

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
 * `authenticated`、`logoutOrder` 与 `passkeyEnabled` 恒在。身份字段只在 password 模式、会话有效
 * 且账号仍在 `users.yaml` 时出现，否则整组缺席（不出现 `null` 占位，不泄漏账号是否存在）。
 * 可选字段显式带 `| undefined`（`exactOptionalPropertyTypes`），JSON 里缺席与 `undefined` 等价。
 */
export interface StatusResponse {
  authenticated: boolean;
  /** 「退出登录」按钮在通用设置页的槽位 order（host 配置透传）。 */
  logoutOrder: number;
  /**
   * 本实例是否启用了通行密钥（passkey）登录：host 配置透传，恒在。
   *
   * token 模式恒 `false`。只表示实例能力，**不**表示「当前用户是否已注册通行密钥」：
   * 已注册凭据只出现在需要会话的凭据列表里，未认证可读的响应不泄漏这类身份信息。
   */
  passkeyEnabled: boolean;
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

/**
 * `POST /auth/passkey/options` 的 200 响应体（浏览器直接交给 `navigator.credentials.get`）。
 *
 * **有意裁剪为五个字段**：库的 `PublicKeyCredentialRequestOptionsJSON` 还带 `extensions`/`hints`
 * 等可选字段，本插件不使用（也不希望它们悄悄改变浏览器行为），因此这里显式投影而不是原样透传；
 * 将来要支持某个扩展时，先在这里加字段（契约只做加法）。
 */
export interface PasskeyLoginOptionsResponse {
  challenge: string;
  rpId: string;
  timeout: number;
  /** 策略固定 `required`（不提供「关 UV」配置）。 */
  userVerification: "required";
  /** 无用户名登录：恒为空数组（discoverable credentials）。 */
  allowCredentials: readonly never[];
}

/**
 * `POST /auth/passkey/login` 的请求体（`application/x-www-form-urlencoded` 扁平字段）。
 * 二进制一律 base64url；`user_handle`/`next` 可缺席。
 */
export interface PasskeyAssertionRequest {
  id: string;
  client_data_json: string;
  authenticator_data: string;
  signature: string;
  user_handle?: string;
  next?: string;
}

/** passkey 登录的 JSON 错误体（fetch 路径）；表单路径失败渲染登录卡片。 */
export interface PasskeyLoginErrorBody {
  error: "bad_request" | "unauthorized" | "locked" | "unavailable";
  /** 429 时同时写 `retry-after` 头。 */
  retryAfter?: number;
}

/** 一把凭据的公开摘要（列表用）：**绝不含**公钥、userHandle 或任何密钥材料。 */
export interface PasskeySummary {
  /** credentialId 前 12 字符（完整值不出现在列表里）。 */
  idPrefix: string;
  label: string;
  /** epoch ms。 */
  createdAt: number;
  /** epoch ms；0 = 从未使用。 */
  lastUsedAt: number;
  /** BE（可备份/可同步）。 */
  backupEligible: boolean;
  /** BS（已备份）。 */
  backupState: boolean;
  transports: string[];
}

/** `GET /auth/passkey` 的 200 响应体（按 createdAt 升序，client 不重排）。 */
export interface PasskeyListResponse {
  passkeys: PasskeySummary[];
}

/**
 * `POST /auth/passkey/register/options` 的 200 响应体：库的
 * `PublicKeyCredentialCreationOptionsJSON` 原样透传（注册侧需要 `excludeCredentials`/`rp`/`user`
 * 等全部字段，不做裁剪）。
 */
export type PasskeyRegistrationOptionsResponse = Record<string, unknown>;

/**
 * `POST /auth/passkey/register` 的请求体（urlencoded 扁平字段，二进制一律 base64url）。
 * `password`/`code` 是**再认证**凭据：会话本身不足以注册（防「会话被劫 → 后门 passkey」）。
 */
export interface PasskeyRegistrationRequest {
  label: string;
  password: string;
  code: string;
  id: string;
  client_data_json: string;
  attestation_object: string;
  transports: string;
}

/** `POST /auth/passkey/remove` 的请求体。`all=1` 表示清空；否则按 `id` 前缀唯一匹配。 */
export interface PasskeyRemoveRequest {
  id: string;
  all?: string;
  password: string;
  code: string;
}

/** `GET/POST /auth/passkey/settings` 的响应体（admin）。 */
export interface PasskeySettingsResponse {
  /** 登录页是否启用 passkey 自动填充（条件 UI）。 */
  conditionalUiEnabled: boolean;
}

/** `POST /auth/passkey/settings` 的请求体。 */
export interface PasskeySettingsRequest {
  conditionalUi: string;
}

/** passkey 管理端点的 JSON 错误体。 */
export interface PasskeyAdminErrorBody {
  error: "unauthorized" | "forbidden" | "locked" | "unavailable" | "bad_request" | "not_found";
  /** 400 `policy` 类错误的细分原因（如 `last-credential`）。 */
  reason?: string;
  retryAfter?: number;
}
