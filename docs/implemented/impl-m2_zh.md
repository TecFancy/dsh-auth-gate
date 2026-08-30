# dsh-auth M2 实施规格（executable spec）

> 读者：执行实现的编码代理（预期 deepseek v4 flash，**新 session**）。本文档是**决策完备的规格**：
> 所有判断点已预先关闭，执行者只做翻译，不做设计。
> 基线：`docs/implemented/impl-m1_zh.md`（M1 已交付：守卫包装、自检、会话存储、auth 服务骨架——M2 在其上叠加）。
> 设计依据：`docs/specs/dsh-auth-plan_zh.md` §5/§6 阶段 1/§8；工程门禁：`docs/specs/development.md`。
> **本文件是 M2 的唯一权威细则**；与 plan/M1 冲突时以本文件为准。
>
> 环境与验证工作流见 `docs/handoff/handoff-m2_zh.md`（新 session 必读：服务器访问、沙箱网络限制、
> M1 踩坑清单）。**禁止自行探索 harness 内部**——需要本文件之外的事实，停下报告。

---

## 1. M2 目标

把 M1 的惰性门（`noopGate` 全放行）替换为**共享 token 门**：

- 未认证请求被守卫拒绝（HTML 导航 → 302 登录页；API/WS → 401/拒握手——M1 管线已就绪）；
- `GET /auth/login` 自包含登录页 + `POST /auth/login` 提交 token → 恒时校验 → 发持久化会话 cookie；
- `Authorization: Bearer <token>` 直接通过守卫（curl/脚本友好）；
- `POST /auth/logout` 吊销会话；`GET /auth/status` 报告认证状态；其余 `/auth/*` 路径一律 404 兜底
  （不落到 SPA fallback）。

M1 的守卫/会话/自检全部复用，**不改其行为**；本里程碑只换门 + 加端点。

---

## 2. 冻结决策表（M2 增量；M1 的 D1–D16 不变）

| #   | 决策         | 冻结值                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | gate 替换    | `apply` 用 `TokenGate` 实例替换 `noopGate`；`AuthService.gate` 字段保持可写（测试注入、M3 换门兼容）                                                                                                                                                                                                                                         |
| M2  | token 来源   | config `tokenRef: string` = credentials 引用名（环境变量名），默认 `"DSH_AUTH_TOKEN"`；**每次 decide 经 `ctx.credentials.resolve(tokenRef)` 重新解析**（credentials 服务 per-operation 语义，改凭证无需重启）；credentials 服务缺失 → **首次解析时** `log.error` + 门**恒 deny**（fail-closed；告警惰性触发——见 §3.1 挂载竞态）              |
| M3  | 校验方式     | 恒时比较：`crypto.timingSafeEqual(sha256(input), sha256(stored))`（双方先哈希再比较，长度恒等；`safeEqual(input, stored)` 导出可测）                                                                                                                                                                                                         |
| M4  | 公共路径     | `TokenGate` 恒放行 `/auth` 与 `/auth/*`（常量 `AUTH_PATH_PREFIX = "/auth"` 放 `guard.ts`）；兜底前缀 + 三个 exact 端点经**包装后的** `register` 注册（被守卫包装但被 gate 放行——与 plan §5 白名单一致，自检无缺口、重启自愈；不做独立白名单配置项）                                                                                          |
| M5  | 端点集       | `GET /auth/login`（自包含 HTML）、`POST /auth/login`（urlencoded：`token` + `next`）、`POST /auth/logout`、`GET /auth/status`（JSON `{ authenticated: boolean }`）。路由模型见 M15（3 exact + 1 prefix 兜底）；`/auth/status` **只认 cookie**（Bearer 不参与——无状态通道不建会话，不是"会话状态"）                                           |
| M6  | 会话语义     | 登录成功 → `SessionStore.create("token", ttl)`（subject 恒 `"token"`，plan §5；**每次登录都是新会话**，防固定天然满足）；cookie 由 `buildSetCookie` 输出                                                                                                                                                                                     |
| M7  | cookieSecure | config `cookieSecure: boolean` 默认 `true`；`false` 时 cookie 省略 `; Secure`（http 测试/开发）。`buildSetCookie` 增加可选第 4 参 `secure = true`（**向后兼容** M1 签名与测试）                                                                                                                                                              |
| M8  | next 校验    | 必须以单个 `/` 开头、非 `//` 开头、不含 `\`；否则回落 `/`（防开放重定向）                                                                                                                                                                                                                                                                    |
| M9  | Bearer       | `Authorization: Bearer <token>` 恒时校验通过即放行，**不建会话**；HTTP 与 upgrade 都生效（浏览器 WS 无法自定义头，cookie 是浏览器通道——文档注明）                                                                                                                                                                                            |
| M10 | body 解析    | 仅接受 `application/x-www-form-urlencoded`（判定：取首个 `;` 前的 token，`trim().toLowerCase()` 后**全等**——不用 startsWith，会误收 `...x` 后缀）；大小上限 16 KiB（超限 413，见 M19）；`URLSearchParams` 解析；不符 415                                                                                                                     |
| M11 | mode 语义    | `"token"`（默认）激活 TokenGate；`"password"` 在 M2 `apply` 直接抛错（fail loud；M3 实现）                                                                                                                                                                                                                                                   |
| M12 | 依赖         | **零新增**：`node:crypto`/`URLSearchParams` 内建；credentials 服务用结构类型 `ctx.get("credentials") as unknown as CredentialRefResolver`（不 import 包类型 → 不加依赖）                                                                                                                                                                     |
| M13 | 限速         | M2 **不做**（token 256-bit 熵足够；M3 password 流加 IP+账号限速）                                                                                                                                                                                                                                                                            |
| M14 | CSRF         | M2 不做登录/登出 CSRF token（登录 CSRF 影响可忽略、`SameSite=Lax` 已覆盖大部分；文档注明，M3 评估）                                                                                                                                                                                                                                          |
| M15 | 路由模型     | webserver **无 method 路由**（`exact` 表只按 pathname 建键、重复 path 抛错——实测）→ **3 条 exact 路由**（`/auth/login`、`/auth/logout`、`/auth/status`）+ **1 条 prefix 兜底**（`/auth` → 404，防未注册 `/auth/*` 落到 SPA fallback，M20）；每个 exact handler 内部按 `req.method` 分发，非白名单 method → `405` + `allow` 头 + `text/plain` |
| M16 | 会话访问器   | `sessions` 一律以访问器 `() => SessionStore \| undefined` 注入（TokenGate 与 AuthEndpointsDeps **同形**）；`apply` 中 `auth` 对象**一步成型**：`gate: new TokenGate({ ..., sessions: () => auth.sessions })`（闭包自引用，apply 内无 await、无裸奔窗口）；`noopGate` import 移除（`gate.ts` 导出保留，测试用）                               |
| M17 | 恒时比较     | `timingSafeEqual` **只接受 Buffer/TypedArray**（hex 字符串直接 TypeError——本机实测）→ `safeEqual` 用 `createHash("sha256").update(x).digest()`（Buffer，双方恒 32 字节），**不用** `digest("hex")`                                                                                                                                           |
| M18 | 测试凭证     | 集成测试用**结构型假 provider**（`ctx.provide("credentials", { resolve })`，先于本插件挂载）；真实 `LocalCredentialProvider` 只在服务器冒烟（DoD 4）覆盖。**零新增依赖（含 devDependencies）**——`dsh-credentials-local` 及其 5 个 peer 包不进 package.json                                                                                   |
| M19 | 413 处理     | 超限：停止累积、`throw { status: 413 }`；端点写 `connection: close` + `413` + `res.end()`，**不调用 `req.destroy()`**（实测：destroy 会毁掉 keep-alive，后续请求 socket hang up）                                                                                                                                                            |
| M20 | 白名单兜底   | prefix `/auth` 兜底路由经**包装后**的 register 注册，handler 恒 404（自检计入覆盖）；`validateNext` 额外拒绝 `"/auth"` 与 `/auth/*`（回落 `/`）——防登录后 302 回环；`GET /auth/login` 恒渲染登录页（不查会话、不重定向）                                                                                                                     |
| M21 | 端点日志     | 冻结日志事件：登录失败 `info`（"login rejected"）、登录成功 `info`（"session issued"）、503 `error`、logout `info`（"logout"）；**任何日志永不包含 token 值/session token**（`AuthEndpointsDeps.logger` 由此消费）                                                                                                                           |
| M22 | logout 语义  | `next` 仅从 **query** 取（无则 `/`）；**不解析 body、不要求 content-type**（裸 `curl -X POST` 可用）；cookie 缺失也照常 302 + 清 cookie（幂等）                                                                                                                                                                                              |

---

## 3. 权威契约（M2 新增；其余见 impl-m1.md §2）

### 3.1 credentials 服务（`@deepseek-ai/dsh-credentials@0.1.0-rc.6` + `dsh-credentials-local`）

- **web 组合自带**：`dsh-base` bundle 的 `credentials` 行 = `@deepseek-ai/dsh-credentials-local`（读
  `$DSH_HOME/.credentials.yaml`，env 层优先于文件层；**每次 resolve 重新读取**，改文件无需重启）。
- **挂载竞态（实测）**：harness **并行挂载行**——credentials 行（dsh-base）可能在本插件（用户层）
  apply **之后**才就绪（服务器冒烟实测：apply 时 `ctx.get("credentials") === undefined`，数秒后
  可见）。因此解析器**每次 resolve 惰性 `ctx.get("credentials")`**（§4.6 item 3），缺失告警也在
  首次解析时触发——既是 M2 的 per-operation 语义，也天然规避竞态（M2 行冻结值已同步修订）。
- 服务面：`ctx.credentials.resolve(ref): Promise<{ value: string; source: string } | undefined>`
  （ref 是环境变量名形式的字符串；未配置 → `undefined`）。我们**不 import 包类型**，用结构类型：
  ```ts
  interface CredentialRefResolver {
    resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
  }
  ```
- 本插件**只读**凭证，不 set/unset。`CredentialRefResolver` 结构接口声明在 `src/index.ts`
  （私有，不导出）。
- `dsh-credentials-local` 是类插件（named export `LocalCredentialProvider`，Config 含 `path?`）：
  服务器冒烟直接复用 web 组合自带的 `credentials` 行，写 `$DSH_HOME/.credentials.yaml`。
  **文件权限必须 0600**：`assertOwnerOnly` 在文件存在且 group/other 可读时启动即抛错
  （`chmod 600`）。**集成测试不挂真实 provider**（M18：零新增依赖）——用结构型假 provider
  `ctx.provide("credentials", { resolve })` 先于本插件挂载；真实 provider 的 env 层优先语义
  （`process.env[tokenRef]` 可直接供冒烟）在服务器侧验证。
- 服务缺失（首次解析时 `ctx.get("credentials") === undefined`，惰性）：`log.error("credentials
service is unavailable: gate denies everything (fail-closed)")` 一次；`TokenGate` 的 resolver
  返回 `undefined` → 所有凭证校验失败 → 恒 deny（但白名单 `/auth/*` 仍放行，登录页可见、登录
  不可用——可诊断）。

### 3.2 node 内建（本包静态形态，均可用）

- `node:crypto`：`randomBytes`（M1 已用）、`createHash("sha256")`、`timingSafeEqual`。
- `URLSearchParams`（global，Node ≥ 22）：解析 urlencoded body 与构造 query。
- `req` 流读取：`for await (const chunk of req)` 累积，超限即断（413，M19）。
- `timingSafeEqual(a, b)` 只接受 Buffer/TypedArray/DataView——hex 字符串直接抛 TypeError（本机
  实测）；`safeEqual` 内部一律 `digest()`（Buffer，M17），不用 `digest("hex")`。

---

## 4. 文件蓝图

每个文件 ≤250 行、函数 ≤80 行、复杂度 ≤15（ESLint error）。M1 文件只增改三处：`session-store.ts`
（`buildSetCookie` 加参）、`guard.ts`（仅新增 `AUTH_PATH_PREFIX` 常量，行为不变）、`src/index.ts`
（装配）。**gate/self-check 不动**（`gate.ts` 的 `noopGate` 保留导出——测试仍用；`GuardKind`/`Gate` 不变）。

### 4.1 `src/cookie.ts` —— 请求 Cookie 头解析

```ts
/** 从 Cookie 头解析指定名字的值；同名取首个。无头/无此名 → undefined。 */
export function parseCookieHeader(header: string | undefined, name: string): string | undefined;
```

行为约定：`split(";")` → 每段 `trim()` → 首个 `"="` 切分 → 名字精确匹配。值不去引号（token 无引号）。
空值返回 `""`（调用方自行判定）。纯函数，导出测试。

### 4.2 `src/token-gate.ts` —— 共享 token 门

```ts
import type { IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Gate, GuardKind } from "./gate.js";
import type { SessionStore } from "./session-store.js";
import { AUTH_PATH_PREFIX } from "./guard.js";
import { parseCookieHeader } from "./cookie.js";

/**
 * 恒时比较：双方 sha256 Buffer 摘要后 timingSafeEqual（M17：timingSafeEqual 只接受
 * Buffer/TypedArray——hex 字符串直接 TypeError；Buffer 摘要双方恒 32 字节，无长度侧信道）。
 */
export function safeEqual(input: string, stored: string): boolean;

export interface TokenGateOptions {
  /** 每次 decide 调用的凭证解析器（index.ts 注入 credentials.resolve 闭包）。 */
  resolveToken: () => Promise<string | undefined>;
  /** 会话访问器（M16）：每次 decide 现取——domain 异步就绪；undefined = cookie 通道不可用。 */
  sessions: () => SessionStore | undefined;
  cookieName: string;
}

export class TokenGate implements Gate {
  constructor(options: TokenGateOptions);
  decide(req: IncomingMessage, kind: GuardKind, pathname: string): Promise<"allow" | "deny">;
}
```

`decide` 顺序（照此实现）：

1. `pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")` → `"allow"`。
2. cookie：`parseCookieHeader(req.headers.cookie, this.cookieName)` → 非空
   （`!== undefined && !== ""`）且 `this.sessions()?.getByToken(token) !== undefined` → `"allow"`
   （`sessions()` 返回 undefined 则跳过此通道）。
3. Bearer：`req.headers.authorization` 匹配 `/^Bearer\s+(.+)$/i` → `await this.resolveToken()` →
   存在且 `safeEqual(bearer, stored)` → `"allow"`。
4. 否则 `"deny"`。

错误语义（fail-closed）：`resolveToken` 抛错 → 本门 catch 后返回 `"deny"`（不向上抛、不打日志；
index.ts 的 resolver 已自行 catch 并记日志——生产路径不会抛到此处，本 catch 是防御性双保险）。

### 4.3 `src/form-body.ts` —— urlencoded 表单体读取

```ts
import type { IncomingMessage } from "node:http";

export const FORM_BODY_LIMIT = 16 * 1024;

/** 读取并解析 urlencoded 请求体。返回 415（content-type 不符）/ 413（超限）时抛出带 status 的错误。 */
export async function parseFormBody(req: IncomingMessage): Promise<URLSearchParams>;
```

行为约定：`content-type` 判定取首个 `;` 前的 token，`trim().toLowerCase()` 后**全等**
`application/x-www-form-urlencoded`（M10：不用 startsWith，会误收 `...x` 后缀），不符
`throw Object.assign(new Error("unsupported media type"), { status: 415 })`；
`for await` 累积 chunks，总量 > `FORM_BODY_LIMIT` 时停止累积并
`throw ... { status: 413 }`（**不调用 `req.destroy()`**，M19）；`new URLSearchParams(decoded)` 解析。
错误对象带 `status` 字段——auth-endpoints 据此写响应；**不带 `status` 的流异常（abort 等）不捕获，
向上抛**（webserver 统一 warn + 400，与守卫纪律一致）。

### 4.4 `src/login-page.ts` —— 自包含登录页

```ts
/** 渲染自包含登录页（内联样式，零第三方资源）。next/error 全部 HTML-escape。 */
export function loginPageHtml(next: string, error?: string): string;
```

行为约定：`<!doctype html>` + `lang="en"`；内联 `<style>`（基础居中卡片样式，light 即可，不引外部字体）；
`<form method="post" action="/auth/login">`；hidden `next`（escape 后）；`<input type="password" name="token"
autocomplete="current-password" required autofocus>`；`<button type="submit">Unlock</button>`；
`error` 非空时渲染 `<p class="error">`（escape）。HTML-escape helper 为本文件私有
（`& < > " '` 五个字符），导出仅 `loginPageHtml`。

### 4.5 `src/auth-endpoints.ts` —— /auth 兜底 + 三个端点

```ts
import { AUTH_PATH_PREFIX, type HttpHandler } from "./guard.js";
import { buildSetCookie, type SessionStore } from "./session-store.js";
import { parseFormBody } from "./form-body.js";
import { loginPageHtml } from "./login-page.js";
import { parseCookieHeader } from "./cookie.js";

export interface AuthEndpointsDeps {
  /** 注册路由（index.ts 传入包装后的 server.register；被守卫包装但被 gate 白名单放行）。 */
  register(route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): () => void;
  /** 会话访问器（M16）：domain 异步就绪，端点内每次现取。 */
  sessions: () => SessionStore | undefined;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number; // 秒
  validateToken: (token: string) => Promise<boolean>; // 恒时校验（index.ts 注入 safeEqual 闭包）
  logger: { error(message: unknown): void; info(message: unknown): void };
}

/** 注册 prefix `/auth` 兜底 + 三个 exact 端点；返回合并 disposer（内部收集每个 register 的 disposer）。 */
export function registerAuthEndpoints(deps: AuthEndpointsDeps): () => void;
```

路由模型（M15：webserver 无 method 路由——`exact` 表只按 pathname 建键、重复 path 抛错，故
GET/POST `/auth/login` **不能**注册两条 exact 路由）：

- **prefix `AUTH_PATH_PREFIX`（= `"/auth"`，兜底，M20）**：恒 `404` + `content-type: text/plain` +
  no-store——未注册的 `/auth/*` 不得落到 SPA fallback（exact 优先于 prefix，不遮蔽下面三个端点）。
  路由 path 用 `AUTH_PATH_PREFIX` 常量（本节 import 的唯一消费方）。
- **exact `/auth/login`**：handler 内按 `req.method` 分发：
  - `GET`：`next = validateNext(query.get("next") ?? "/")` → `200` +
    `content-type: text/html; charset=utf-8` + `cache-control: no-store` + `loginPageHtml(next)`。
    **恒渲染登录页**（不查会话、不重定向——M20）。
  - `POST`：`parseFormBody(req)`——带 `status` 的错误 → 对应 status + `text/plain` 消息
    （413 额外先 `res.setHeader("connection", "close")`，M19）；**不带 `status` 的异常向上抛**
    （webserver 统一 warn + 400）；`token = params.get("token") ?? ""`；
    `next = validateNext(params.get("next") ?? "/")`；
    `await deps.validateToken(token)` 失败 → `401` + `text/plain` `"invalid token"` +
    `cache-control: no-store` + `logger.info("login rejected")`；
    成功 → `const store = deps.sessions(); store === undefined` → `503` + `text/plain`
    `"session store unavailable"` + no-store + `logger.error("login failed: session store unavailable")`
    （fail-closed，不静默放行）；否则
    `const { token: sessionToken } = await store.create("token", deps.sessionTtl * 1000)`；
    `res.setHeader("set-cookie", buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure))`；
    `res.writeHead(302, { location: next }); res.end();` + `logger.info("session issued")`
    （全程 no-store）。
  - 其他 method → `405` + `allow: GET, POST` + `text/plain`（no-store）。
- **exact `/auth/logout`**：仅 `POST`（其他 → `405` + `allow: POST`）：
  `next = validateNext(query.get("next") ?? "/")`（M22：next 仅从 query 取；
  **不解析 body、不要求 content-type**——裸 `curl -X POST` 可用）；
  `const store = deps.sessions(); const token = parseCookieHeader(req.headers.cookie, deps.cookieName);`
  `token` 非空（`!== undefined && !== ""`）且 `store !== undefined` →
  `await store.revokeByToken(token)`（无会话/无 cookie 静默成功）；
  `res.setHeader("set-cookie", buildSetCookie(deps.cookieName, "", 0, deps.cookieSecure))`（Max-Age=0 清除）；
  `res.writeHead(302, { location: next }); res.end();` + `logger.info("logout")`；no-store。
- **exact `/auth/status`**：仅 `GET`（其他 → `405` + `allow: GET`）：
  只认 cookie（M5：Bearer 不参与——无状态通道不建会话，不是"会话状态"）：
  `const store = deps.sessions(); const token = parseCookieHeader(req.headers.cookie, deps.cookieName);`
  `const authenticated = store !== undefined && token !== undefined && token !== "" &&
store.getByToken(token) !== undefined;`
  → `200` + `application/json` + `JSON.stringify({ authenticated })` + no-store。

`validateNext` 为本文件私有导出：`next` 以单个 `/` 开头
（`next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")`）**且**
`next !== "/auth"`、`!next.startsWith("/auth/")`（M20：拒 /auth* 防登录后 302 回环）→ 原样；否则 `"/"`。
`req.url` 的 query 解析用 `new URL(req.url ?? "/", "http://x")`（与守卫一致）。
全部端点响应带 `cache-control: no-store`；日志事件见 M21（任何日志**永不**包含 token 值/session token）。

### 4.6 `src/index.ts` —— 装配变更（其余 M1 逻辑不动）

1. `Config` 增加两字段（默认值进 schemastery）：
   ```ts
   tokenRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default("DSH_AUTH_TOKEN"),
   cookieSecure: z.boolean().default(true),
   ```
   （`pattern` 与 dsh-credentials 的 credential-ref 模式一致，同时挡住空串。）
   `AuthConfig` 接口同步（`mode`/`sessionTtl`/`cookieName` 不变）。
2. `apply` 开头：`if (config.mode === "password") throw new Error("dsh-auth: password flow requires M3 (not implemented in M2)");`（在 `void config` 处改为真正使用 config）。
3. credentials 解析器（替换 M1 的 `void config`）——**惰性取服务**（§3.1 挂载竞态：credentials 行
   可能在本行 apply 之后才就绪，每次 resolve 现取 `ctx.get("credentials")`）：
   ```ts
   /** credentials 服务的结构镜像（§3.1）；本文件私有，不导出。 */
   interface CredentialRefResolver {
     resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
   }
   /** 返回 resolveToken；服务缺失告警只在首次解析时触发一次（fail-closed，可诊断）。 */
   function makeTokenResolver(
     ctx: Context,
     config: AuthConfig,
     log: { error(message: unknown): void },
   ): () => Promise<string | undefined> {
     let warnedMissing = false;
     return async () => {
       const credentials = ctx.get("credentials") as unknown as CredentialRefResolver | undefined;
       if (credentials === undefined) {
         if (!warnedMissing) {
           warnedMissing = true;
           log.error("credentials service is unavailable: gate denies everything (fail-closed)");
         }
         return undefined;
       }
       try {
         const resolved = await credentials.resolve(config.tokenRef);
         return resolved?.value;
       } catch (error) {
         log.error(
           `token resolution failed: ${error instanceof Error ? error.message : String(error)}`,
         );
         return undefined; // fail-closed：解析失败 = 无凭证
       }
     };
   }
   ```
4. 装配门（M16）：替换 M1 第 3 步的 `{ sessions: undefined, gate: noopGate }`，`auth` 对象**一步成型**：
   ```ts
   const auth: AuthService = {
     sessions: undefined,
     gate: new TokenGate({
       resolveToken,
       sessions: () => auth.sessions, // 访问器闭包自引用 auth（domain 异步就绪后由 open 回调赋值）
       cookieName: config.cookieName,
     }),
   };
   ctx.provide("auth", auth);
   ```
   顺序：log → credentials/resolveToken → auth → provide；apply 内无 await、无裸奔窗口。闭包自引用
   合法（`decide` 时才求值）。`noopGate` 的 import 移除（`gate.ts` 导出保留，测试用）。
5. 端点注册（在 wrapServer 与自检之间；`safeEqual` 从 `./token-gate.js` import）：
   ```ts
   ctx.effect(
     () =>
       registerAuthEndpoints({
         register: (route) => server.register(route), // 包装后的 register（增量保险路径）
         sessions: () => auth.sessions,
         cookieName: config.cookieName,
         cookieSecure: config.cookieSecure,
         sessionTtl: config.sessionTtl,
         validateToken: async (token) => {
           const stored = await resolveToken();
           return stored !== undefined && safeEqual(token, stored);
         },
         logger: log,
       }),
     "dsh-auth: auth endpoints",
   );
   ```
   自检在端点注册**之后**执行（端点也计入覆盖）。
6. 移除对 `noopGate` 的 import（gate.ts 导出保留，测试用）。

### 4.7 `src/session-store.ts` —— 一处向后兼容修改

`buildSetCookie` 增加第 4 参：`secure: boolean = true`；`false` 时输出省略 `; Secure`：
`${cookieName}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`
（注意空格：`Path=/; HttpOnly; Secure; SameSite=Lax` 与 `Path=/; HttpOnly; SameSite=Lax` 都要精确）。

---

## 5. 测试矩阵

M1 测试**全保留**；`src/index.test.ts` 按 §4.6 适配（gate 是 TokenGate 实例、mode=password 抛错、
credentials 缺失 → resolver 恒 undefined + error 日志、storageDomain 与 credentials 双缺失 → 2 条
error 日志、Config 默认值补 `tokenRef`/`cookieSecure`、fake ctx 增加 `credentials` 分支）。新增：

**`src/cookie.test.ts`** — 无头 → undefined；单 cookie；多 cookie 取同名首个；值含 `=`；带空格/引号容错；名不存在 → undefined。

**`src/token-gate.test.ts`** — fake req（headers）+ fake sessions（复用 MemTable 思路）+ fake resolver：

1. 白名单：`/auth`、`/auth/login`、`/auth/whatever` → allow（无任何凭证）。
2. cookie 通道：`sessions()` 返回有效会话 → allow；未知/过期/revoked → 继续走 bearer 或 deny。
3. bearer 通道：`Authorization: Bearer <正确 token>` → allow；错误 token → deny；大小写 `bearer` 前缀可接受；`sessions: () => undefined` 时 cookie 通道跳过但 bearer 仍可用。
4. 无任何凭证 → deny。
5. fail-closed：resolver 抛错 → deny（不向上抛）。
6. `safeEqual` 已知向量：`safeEqual("abc", "abc") === true`、`safeEqual("abc", "abd") === false`、空串对非空 → false。

**`src/form-body.test.ts`** — 正常解析（`token=x&next=%2F`）；无 content-type → 415；非 urlencoded → 415；
`application/x-www-form-urlencoded; charset=UTF-8` → 正常（分号后参数忽略）；
`application/x-www-form-urlencodedx` → 415（全等判定，M10）；超 16 KiB → 413 且**不调用
`req.destroy()`**（fake req 记录 destroy 调用次数，M19）。

**`src/auth-endpoints.test.ts`**（按文件行数上限拆为三个文件：`auth-endpoints.test.ts` 覆盖注册形状/
GET login/logout/status，`auth-endpoints.login.test.ts` 覆盖 POST login，`auth-endpoints.methods.test.ts`
覆盖 405/兜底/loginPageHtml——测试矩阵合并描述）— fake register（记录路由 + 返回 disposer）+ fake
sessions（访问器形态）+ fake validateToken：

1. 注册形状：4 条路由——prefix `/auth`、exact `/auth/login`、`/auth/logout`、`/auth/status`（M15）。
2. GET login：200 + HTML 含 `<form`、hidden next 已 escape（`next="/x?a=1&b=2"` → HTML 里 `&amp;`）；已认证态（`sessions()` 有有效会话）也恒 200 渲染（不重定向，M20）。
3. POST login 成功：validateToken true → 302 location=next + set-cookie 精确串（secure=true 与 false 两种）+ `sessions().create` 被调用（subject "token"、ttl = sessionTtl*1000）+ `logger.info("session issued")`。
4. POST login 失败：validateToken false → 401 "invalid token" + `logger.info("login rejected")`；无会话创建。
5. POST login next 校验：`next="//evil.com"` → 302 location "/"；`next="/ok/path"` → 302 "/ok/path"；**`next="/auth/login"` 与 `/auth/x` → "/"（M20）**。
6. POST login `sessions()` undefined → 503 + `text/plain` + `logger.error`。
7. POST logout：revoke 被调 + set-cookie 含 `Max-Age=0` + 302；next 从 query（`?next=/x` → location `/x`）；无 body/无 content-type 可用；cookie 缺失也 302（幂等，M22）。
8. GET status：有效 cookie → `{"authenticated":true}`；无 → false；带 `Authorization: Bearer` 头不影响结果（只认 cookie，M5）。
9. method 分发：`DELETE /auth/login` → 405 + `allow: GET, POST`；`GET /auth/logout` → 405；`POST /auth/status` → 405。
10. prefix `/auth` 兜底：`/auth/whatever` → 404 + no-store（M20）。
11. 413：body 超限 → 413 + `connection: close` 头 + 不调 `req.destroy`（M19）。

**`src/integration.auth.test.ts`**（真实入口路径）— 真实 cordis + **真实 storage 栈**
（Storage → storage-json → storage-domain，挂载顺序同 M1 `integration.session.test.ts`；否则
`sessions` 恒 undefined → 登录恒 503）+ 真实 WebServer + **结构型假
credentials provider**（M18：`ctx.provide("credentials", { resolve: async (ref) => ref === "DSH_AUTH_TOKEN" ? { value: TEST_TOKEN, source: "test" } : undefined })`，
**先于本插件挂载**；`TEST_TOKEN` 随机生成、永不进快照）+ 本插件（config `{ cookieSecure: false }`，http 无 TLS）：

1. 全流程：`GET /auth/login` → 200；`POST /auth/login` 错 token → 401；对 token →
   302 + `set-cookie` 头 + `location`；带 cookie `GET /__probe`（auth 之后注册的 exact 路由）→ 200；
   无 cookie `GET /__probe` → 302（HTML accept）/ 401（JSON accept）；`Authorization: Bearer 对` → 200；
   Bearer 错 → 401；`POST /auth/logout?next=/`（带 cookie，无 body）→ 302 + Max-Age=0；原 cookie 再访问 `/__probe` → 401。
2. 白名单兜底：`GET /auth/whatever` → 404（非 SPA fallback）；`DELETE /auth/login` → 405。
3. credentials 缺失（不挂 provider）→ 登录 401（resolver undefined）+ 启动日志 error。
4. WS 通道：带会话 cookie 的 upgrade → 101（upgrade 事件）；`Authorization: Bearer <对>` 的 upgrade → 101；无凭证 upgrade → 401 拒握手（复用 M1 `requestUpgradeStatus` 模式，加 cookie/authorization 头变体）。
5. 会话持久化已在 M1 `integration.session.test.ts` 覆盖（复用）。

---

## 6. 实施顺序（每步保持 `npm run verify` 绿）

1. `session-store.ts` buildSetCookie 加参 + `session-store.test.ts` 补用例：`secure=false` 精确串
   `dsh_auth=tok; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`、缺省第 4 参 → 原精确串不变（向后兼容）。
2. `src/cookie.ts` + 测试。
3. `src/token-gate.ts` + 测试。
4. `src/form-body.ts` + 测试。
5. `src/login-page.ts`（纯渲染，随 auth-endpoints 测试覆盖；可先写后测）。
6. `src/auth-endpoints.ts` + 测试。
7. `src/index.ts` 装配 + `src/index.test.ts` 适配（mode=password 抛错、credentials 缺失 fail-closed、gate 为 TokenGate 实例）。
8. `src/integration.auth.test.ts`。
9. `docs/specs/development.md` Structure 树更新为：
   ```
   src/
   ├── index.ts           # plugin entry + auth 服务接线 + credentials 解析器（M2 改装配）
   ├── guard.ts           # 守卫包装/拒绝管线 + AUTH_PATH_PREFIX（M2 加常量）
   ├── gate.ts            # Gate 词表 + noopGate（M2 换真门）
   ├── token-gate.ts      # TokenGate：白名单/cookie/Bearer + safeEqual（M2 新增）
   ├── cookie.ts          # Cookie 头解析（M2 新增）
   ├── form-body.ts       # urlencoded body 读取（M2 新增）
   ├── login-page.ts      # 自包含登录页（M2 新增）
   ├── auth-endpoints.ts  # /auth 兜底前缀 + 三个 exact 端点（M2 新增）
   ├── session-store.ts   # storage-domain 会话持久化（buildSetCookie 加参）
   ├── self-check.ts      # 包装覆盖自检（fail loud）
   ├── *.test.ts          # 单元测试（显式 vitest import）
   └── integration.*.test.ts  # 真实 cordis/webserver/storage 栈集成测试
   ```
   `docs/handoff/handoff-m2_zh.md` 状态快照（§2）与 §5.4 冒烟序列同步更新。

---

## 7. Definition of Done

1. `npm run verify` 全绿（format/lint/type-check/coverage ≥80%/lock:check）。
2. `npm run build` + `lib/` 与 `src/` 同批；`git diff --exit-code -- lib` 通过。
3. `npm run test -- src/integration.auth.test.ts src/integration.guard.test.ts src/integration.session.test.ts` 单独跑绿。
4. **服务器端到端冒烟**（交接文档 §5 工作流，真实 LocalCredentialProvider）：overlay 加
   `config: { cookieSecure: false }` + `$DSH_HOME/.credentials.yaml` 写 `DSH_AUTH_TOKEN: <测试值>`
   （`chmod 600`）→ 重启实例 → curl 验证：未认证 `/__auth_probe` → 302/401；POST 登录 → Set-Cookie；
   带 cookie → 200；Bearer → 200；`GET /auth/whatever` → 404（兜底）；WS upgrade 带 cookie → 101 /
   无凭证 → 401。
5. 报告：改动文件、M1–M22 落点、覆盖率数字、与本文档的偏差（应为零）。

---

## 8. 禁区清单

- **不探索 harness 内部**（同 M1）；credentials 服务只经 §3.1 的结构类型。
- **零新增依赖**（M18）：runtime 与 devDependencies 都不动——`node:crypto`/`URLSearchParams` 够用；
  body 解析/HTML 渲染/cookie 解析全部手写；集成测试用结构型假 credentials provider，**不引入**
  `dsh-credentials-local`。
- **不把凭证落日志/快照**：token 值、session token 永不进日志/测试快照；`resolveToken` 失败只记错误消息。
- **不吞认证失败**：登录失败必须 401（不是静默放行）；credentials 缺失必须 deny（fail-closed）。
- **不动 M1 守卫行为**：`guard.ts` 仅新增 `AUTH_PATH_PREFIX` 常量（行为不变）；`gate.ts`/`self-check.ts`
  不动（`noopGate` 保留导出）。
- **不改门禁/tsconfig/eslint/vitest 配置**；不改依赖之外的 package.json。
- **分支纪律**：`development`；未获指令不 commit/push。
- M3/M4（users.yaml、argon2id、限速、TOTP、`dsh-auth user` CLI）**不做**——需要时只写 `TODO(auth-m3):` 注释。

---

## 9. 明确不做（M2 范围外）

- users.yaml / 多凭证 / 口令登录 / argon2id / 登录限速（M3）。
- TOTP 两段式登录（M4）。
- 登录页美化 / 国际化 / client 半边登出按钮（GUI 组件）。
- CSRF token（M14 注明，M3 评估）。
- 部署侧交付物（正式 `cordis.patch.yml` 生产 patch、部署验收清单）——M2 代码验证后单独做。
