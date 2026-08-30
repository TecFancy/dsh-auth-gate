# dsh-auth M1 实施规格（executable spec）

> 读者：执行实现的编码代理（预期 deepseek v4 flash）。本文档是**决策完备的规格**：
> 所有判断点已预先关闭，执行者只做翻译，不做设计。
> 设计依据见 `docs/specs/dsh-auth-plan_zh.md`；工程门禁见 `docs/specs/development.md`；本文件是两者在
> M1 范围内的唯一权威细则——冲突时以本文件为准。
>
> 所有挂载点事实均已在 `@deepseek-ai/*@0.1.0-rc.6` / `@deepseek-ai/cordis@4.0.1`
> 真实源码与类型声明上核实。**禁止自行探索 harness 内部实现**：需要任何未在本文件
> 出现的事实（字段、签名、行为）时，停下并报告，不得猜测。

---

## 1. 冻结决策表

| #   | 决策               | 冻结值                                                                                                                                                             |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | M1 门行为          | 守卫管线（包装 + 302/401/拒握手）全部实现；`gate` 为 `noopGate`（全放行）。M2 只换 gate，不动守卫                                                                  |
| D2  | 插件依赖           | 硬依赖 `inject: ["webServer"]`；`storageDomain` 用 `ctx.get()` 软读                                                                                                |
| D3  | storageDomain 缺失 | `ctx.logger("dsh-auth").error(...)` 后**继续挂载守卫**（M1 门是惰性的；M2 起改为运行时 deny-all fail-closed）                                                      |
| D4  | auth 服务          | `ctx.provide("auth", { sessions, gate })`；`gate` 是可写字段（M2 换流、测试注入假门）；类型增强 `declare module "@deepseek-ai/cordis"`                             |
| D5  | 守卫标记           | `Symbol.for("dsh-auth.guarded")` 挂在被包装 handler/方法上；重复包装幂等（已标记则原样返回）                                                                       |
| D6  | 生命周期可逆       | `ctx.effect` 注册还原器；还原器反向执行：先撤守卫，再关 domain。还原 = 恢复快照 + 原方法                                                                           |
| D7  | 拒绝响应           | 浏览器导航（GET 且 `Accept` 含 `text/html`）→ `302 /auth/login?next=<encoded pathname>`；其余 HTTP → `401` body `unauthorized`；两者都带 `cache-control: no-store` |
| D8  | WS 拒绝            | 不进入 ws 协商：`socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")` 后 `socket.destroy()`；守卫不为 socket 附加任何监听器                     |
| D9  | 自检失败           | 逐条 `logger.error` 后 `throw new Error("dsh-auth: guard self-check failed: ...")`（fiber 启动失败 = fail loud）                                                   |
| D10 | 会话 token         | `randomBytes(32).toString("base64url")`（43 字符，无填充）；落盘键 = `sha256` hex 小写（64 字符）；**日志永不输出完整 token**                                      |
| D11 | 会话 TTL           | 默认 `604800` 秒（7 天），自创建起固定过期、不滑动                                                                                                                 |
| D12 | 登出语义           | 吊销 = 删除行（`delete`）；`pruneExpired` 在每次 `create` 前全表扫描清理过期行                                                                                     |
| D13 | Cookie             | `buildSetCookie(name, token, maxAge)` 输出精确格式 `<name>=<token>; Max-Age=<secs>; Path=/; HttpOnly; Secure; SameSite=Lax`（M2 使用，M1 冻结并测试）              |
| D14 | Config             | schemastery（与 harness 一致）；record schema 用 zod（storage-domain 的分工约定）                                                                                  |
| D15 | 模块系统           | NodeNext；相对导入一律 `.js` 后缀；禁 `console.*`；日志走 `ctx.logger("dsh-auth")`                                                                                 |
| D16 | 幂等重挂           | 同一 server 第二次 `wrapServer` 返回同一 unwrap（`WeakMap` 记录），不产生双守卫                                                                                    |

---

## 2. 权威契约（挂载点事实）

### 2.1 `webServer` 服务（`@deepseek-ai/dsh-host-webserver@0.1.0-rc.6`）

运行时事实（`private` 仅是 TS 层面，运行时全部可达）：

- 表：`server.exact: Map<string, WebRoute>`、`server.prefixes: Map<string, WebRoute>`、
  `server.upgrades: Map<string, WebUpgradeRoute>`；`server.fallback: handler | undefined`。
- `WebRoute = { kind: "exact" | "prefix"; path: string; handler: (req, res) => void | Promise<void> }`；
  `WebUpgradeRoute = { path: string; handler: (req, socket: Duplex, head: Buffer) => void | Promise<void> }`。
- 注册方法：`register(route)`（重复 `(kind, path)` 抛错）、`registerUpgrade(route)`（重复 path 抛错）、
  `registerFallback(handler)`（第二个抛错）。**三者都返回 disposer**，disposer 按 path 删表项——
  原地替换表项内容不破坏已发出 disposer 的语义。
- 分发（请求时查表）：`match(pathname)` = exact 表精确命中 → 否则最长前缀（`pathname === prefix` 或
  `pathname.startsWith(prefix + "/")`）→ 否则 fallback → 否则 404。
- 升级分发：`upgrade` 事件里 `this.upgrades.get(new URL(req.url ?? "/", "http://x").pathname)`，
  未命中销毁 socket。
- 错误处理：async handler 抛错由 webserver 统一捕获：`ctx.logger.warn` + 未发头则 400 / 已发头则 destroy。
  守卫**不得吞掉 handler 错误**（直接向上抛，交给这条路径）。
- 服务形态：`WebServer extends Service`，`super(ctx, "webServer")` 注册服务；`static Config` 为
  schemastery（`host: "127.0.0.1" | "0.0.0.0"`，`port: z.natural().max(65535)`，port 0 = 系统分配）。
  挂载后监听立即生效（`[Service.init]`），`instance.port` 是最终监听端口。

### 2.2 storage domain（`@deepseek-ai/dsh-storage-domain@0.1.0-rc.6`）

- 模块导出：`defineDomain(spec)`、`domainTable(zodSchema)`；`ctx.storageDomain: DomainFacility`。
- `DomainFacility.open(spec): Promise<Domain<S>>` —— **调用者拥有返回的 handle**，必须自己在
  effect disposer 里 `await domain.close()`（幂等）。
- `Domain<S>`：`domain.table(name): KvTable<K, V>`（handle 稳定，可重复取）；`domain.close(): Promise<void>`。
- `KvTable`：`get(key): V | undefined`（同步内存读）、`put(key, value): Promise<void>`、
  `delete(key): Promise<boolean>`、`entries(): IterableIterator<[K, V]>`（快照迭代）、`size: number`。
  写先落介质再改内存；返回的记录是存储对象本身，**不得原地修改**。
- `DomainSpec = { name: string; version: number; global?: ...; tables: Record<string, DomainTableSpec> }`。
  spec 的 record schema 用 **zod**（`z.infer` 派生类型，不手写重复类型）。
- **名称约束（实测核实）**：`DomainSpec.name` 与表名都必须匹配
  `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`（`@deepseek-ai/dsh-storage` 导出）——**禁止连字符**，
  否则 `defineDomain` 在模块加载时抛错。故本插件 domain 名为 `dsh_auth_sessions`（下划线）。
- 后端：`dsh-storage-json` 以 `backend: "json"` 注册，root 下每 unit 一个 `<unit>.json` 文件；
  文件格式（实测核实）：`{ unit: { name, version }, global, tables: { <table>: { <key>: record } } }`，
  pretty-printed + 末尾换行。`dsh-storage-domain` 的 Config `{ backend: "json" }`（本机 web profile 已这样配置）。
- 真实 web 组合中 `storage-domain` 行在 bundle 层（`dsh-web-app`），profile 层之后才挂我们的行，
  因此 apply 时 `ctx.get("storageDomain")` 正常可见；集成测试中先挂 storage 栈再挂本插件。

### 2.3 cordis Context（`@deepseek-ai/cordis@4.0.1`）

- 对象插件形状：`{ name, inject, apply, Config }`；`inject` 声明的服务可用后 apply 才执行。
- `ctx.get(name)` 软读；`ctx.provide(name, value)` 提供服务（随 fiber 自动注销）。
- `ctx.effect(callback, label)`：callback 返回 disposer（同步或异步皆可），fiber 卸载时
  **按注册逆序**执行 disposer。挂载：`ctx.plugin(plugin, ...config)` 返回 `Fiber & PromiseLike<Fiber>`，
  `Fiber.dispose(): Promise<void>` 卸载。
- `ctx.logger` 本身是 logger 实例；`ctx.logger("dsh-auth")` 返回命名 logger（`error/warn/info`）。
- `new Context()` 自带内建服务（logger/registry/reflect）。

---

## 3. 依赖变更（`package.json`）

```jsonc
{
  "dependencies": {
    "@deepseek-ai/dsh-storage-domain": "^0.1.0-rc.6", // 新增：src 运行时 import（defineDomain/domainTable）
    "@deepseek-ai/schemastery": "^3.18.1", // 已有
    "zod": "^4.4.3", // 已有
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1", // 从 dependencies 移入（宿主提供实例）
  },
  "devDependencies": {
    // 新增（仅测试/类型）：
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-host-webserver": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-storage": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-storage-json": "^0.1.0-rc.6",
    // 其余保持不动
  },
}
```

- 安装必须 `npm install --registry=https://registry.npmjs.org/`（AGENTS.md 锁仓规则；全部包已在
  公共 npm 核实存在，版本精确）。
- src 中**不得** import `dsh-host-webserver`/`dsh-storage`/`dsh-storage-json`（它们只出现在测试里）；
  src 对 webserver 用自定义结构类型（§4.2）。

---

## 4. 文件蓝图

每个文件：职责、导出签名、行为约定、长度预算（文件 ≤250 行、函数 ≤80 行、复杂度 ≤15，均为
ESLint error，违反即红）。

### 4.1 `src/gate.ts` —— 门决策词表与惰性门

```ts
import type { IncomingMessage } from "node:http";

/** Guard 判定时报告的被包装入口类别。 */
export type GuardKind = "exact" | "prefix" | "upgrade" | "fallback";

/** allow = 放行原 handler；deny = 由守卫执行 302/401/拒握手（§D7/D8）。 */
export type GateDecision = "allow" | "deny";

export interface Gate {
  decide(
    req: IncomingMessage,
    kind: GuardKind,
    pathname: string,
  ): GateDecision | Promise<GateDecision>;
}

/** M1 惰性门：恒放行。M2 用 token/密码门整体替换。 */
export const noopGate: Gate = { decide: () => "allow" };
```

行为约定：`GuardKind` 定义在此处（`guard.ts` 依赖它，方向单向，无循环 import）。

### 4.2 `src/guard.ts` —— 包装机制与拒绝管线（核心风险文件）

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Gate, GuardKind } from "./gate.js";

export const GUARDED: unique symbol = Symbol.for("dsh-auth.guarded");
export const LOGIN_PATH = "/auth/login";

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export type UpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void | Promise<void>;

export interface WrappableRoute {
  kind: "exact" | "prefix";
  path: string;
  handler: HttpHandler;
}
export interface WrappableUpgradeRoute {
  path: string;
  handler: UpgradeHandler;
}

/** webServer 运行时形状的结构镜像（§2.1）；真实实例运行时满足它。 */
export interface WrappableServer {
  exact: Map<string, WrappableRoute>;
  prefixes: Map<string, WrappableRoute>;
  upgrades: Map<string, WrappableUpgradeRoute>;
  fallback: HttpHandler | undefined;
  register(route: WrappableRoute): () => void;
  registerUpgrade(route: WrappableUpgradeRoute): () => void;
  registerFallback(handler: HttpHandler): () => void;
}

export type GuardLog = { error(message: unknown): void };

// 签名说明：`Function` 被 lint（no-unsafe-function-type）禁用，用任意函数形
// 式 `(...args: never[]) => unknown` 表达"接受任意 callable"。
export function isGuarded(target: (...args: never[]) => unknown): boolean;
export function guardHttp(gate: () => Gate, kind: GuardKind, handler: HttpHandler): HttpHandler;
export function guardUpgrade(gate: () => Gate, handler: UpgradeHandler): UpgradeHandler;
export function denyHttp(req: IncomingMessage, res: ServerResponse): void;
export function denyUpgrade(socket: Duplex): void;
export function wrapServer(server: WrappableServer, gate: () => Gate, log: GuardLog): () => void;
```

实现约定（逐条执行，不得偏离）：

- `guardHttp`：若 `handler[GUARDED] === true` 原样返回（D5 幂等）。否则返回标记过的
  `async (req, res) => { const pathname = new URL(req.url ?? "/", "http://x").pathname; const d = await gate().decide(req, kind, pathname); if (d === "allow") { await handler(req, res); return; } denyHttp(req, res); }`。
  错误不捕获（§2.1 webserver 统一处理）。
- `guardUpgrade`：同构；deny 分支调 `denyUpgrade(socket)`，不调原 handler，不附加 socket 监听器。
- `denyHttp`：`res.setHeader("cache-control", "no-store")`；`req.method === "GET"` 且
  `String(req.headers.accept ?? "").includes("text/html")` → `res.writeHead(302, { location: `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}` }); res.end();`；
  否则 `res.writeHead(401, { "content-type": "text/plain" }); res.end("unauthorized");`。
  header 名用小写（node 规范化为小写）。
- `denyUpgrade`：先 `socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")` 再
  `socket.destroy()`。
- `wrapServer`：
  1. 模块级 `const unwrappers = new WeakMap<WrappableServer, () => void>()`；已存在则返回既有 unwrap（D16）。
  2. 捕获 `orig = { register: server.register.bind(server), registerUpgrade: ..., registerFallback: ... }`
     与快照 `{ exact: new Map(server.exact), prefixes: ..., upgrades: ..., fallback: server.fallback }`。
  3. 原地替换存量：`for (const [p, r] of server.exact) server.exact.set(p, { ...r, handler: guardHttp(gate, "exact", r.handler) })`；
     prefixes 同理（kind 用 `r.kind`）；upgrades 用 `guardUpgrade`；`fallback` 存在则
     `server.fallback = guardHttp(gate, "fallback", server.fallback)`。
  4. 替换实例方法（增量保险，apply 顺序无关）：
     `server.register = (route) => orig.register({ ...route, handler: guardHttp(gate, route.kind, route.handler) })`；
     `registerUpgrade` 用 `guardUpgrade`；`registerFallback = (h) => orig.registerFallback(guardHttp(gate, "fallback", h))`。
     三个替换后的函数都置 `[GUARDED] = true`（自检用，§4.4）。
  5. 返回 unwrap（并存入 WeakMap）：清空四个表并按快照回填（`server.exact.clear()` 后逐个 set 快照项）、
     `server.fallback = snapshot.fallback`、三个方法还原为 `orig.*`。post-wrap 期间新增的注册随还原丢弃
     （disposer 仍按 path 操作当前表，语义安全——还原即整体回滚）。
- `gate: () => Gate` 是访问器而非值：闭包每次请求读最新门（M2 换流、测试注入假门都靠这个）。

### 4.3 `src/session-store.ts` —— 持久化会话（storage domain）

```ts
import { defineDomain, domainTable, type KvTable } from "@deepseek-ai/dsh-storage-domain";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function buildSetCookie(cookieName: string, token: string, maxAgeSeconds: number): string;
// 精确输出：`${cookieName}=${token}; Max-Age=${maxAgeSeconds}; ${COOKIE_FLAGS}`

export function digestToken(token: string): string; // createHash("sha256").update(token).digest("hex")

export interface Session {
  subject: string; // 审计用：产生该会话的凭证身份（M1 恒 "token"，M2 为用户名）
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  revoked: boolean;
}

export interface IssuedSession {
  token: string;
  session: Session;
}

const sessionRowSchema = z.object({
  subject: z.string(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  revoked: z.boolean(),
});
// 键 = digest（64 位 hex 小写），不进 row；row 只存以上四字段。

export const sessionDomainSpec = defineDomain({
  name: "dsh_auth_sessions", // 必须匹配 UNIT_NAME_RE（无连字符，见 §2.2）
  version: 0,
  tables: { sessions: domainTable(sessionRowSchema) },
});

export class SessionStore {
  constructor(table: KvTable<string, Session>);
  create(subject: string, ttlMs: number): Promise<IssuedSession>;
  getByToken(token: string): Session | undefined; // 同步：哈希 → 内存读 → 校验
  revokeByToken(token: string): Promise<boolean>; // delete 的返回值直传
  pruneExpired(now?: number): Promise<number>; // 删全部过期行，返回删除数
}
```

行为约定：

- `create`：先 `await this.pruneExpired()`；`token = randomBytes(32).toString("base64url")`；
  `now = Date.now()`；`put(digest, { subject, createdAt: now, expiresAt: now + ttlMs, revoked: false })`；
  返回 `{ token, session: 同 row }`。
- `getByToken`：`const row = table.get(digestToken(token))`；`row === undefined || row.revoked || row.expiresAt <= Date.now()` → `undefined`；否则返回 row（**不修改 row**）。
- `pruneExpired(now = Date.now())`：`entries()` 遍历，`expiresAt <= now` 的 `await table.delete(key)`，返回计数。
- 本模块**不**负责 domain 的 open/close（那是 `index.ts` 的接线职责）；类对 `KvTable` 编程，
  单测用内存假表，集成测试用真栈。

### 4.4 `src/self-check.ts` —— 启动自检

```ts
import type { WrappableServer } from "./guard.js";

/** 返回未被守卫标记覆盖的入口清单，形如 "exact /api"、"fallback"、"method register"。空 = 通过。 */
export function assertGuarded(server: WrappableServer): string[];
```

行为约定：逐一检查四表全部 handler、`fallback`、以及三个注册方法（替换后的方法带 `[GUARDED]` 标记），
未标记的条目入列。此文件**只报告，不修复、不抛错**（抛错由 `index.ts` 决定）。

### 4.5 `src/index.ts` —— 插件入口与接线

```ts
import type { Context } from "@deepseek-ai/cordis";
import type { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import z from "@deepseek-ai/schemastery";
import { noopGate, type Gate } from "./gate.js";
import { assertGuarded } from "./self-check.js";
import { wrapServer, type WrappableServer } from "./guard.js";
import { sessionDomainSpec, SessionStore } from "./session-store.js";

export const name = "dsh-auth";
export const inject = ["webServer"] as const;

export interface AuthConfig {
  mode: "token" | "password"; // M1 只进 schema；token 门 M2 生效
  sessionTtl: number;          // 秒；默认 604800（7 天）
  cookieName: string;          // 默认 "dsh_auth"
}

export const Config: z<AuthConfig> = z.object({
  mode: z.union([z.const("token"), z.const("password")]).default("token"),
  sessionTtl: z.natural().default(604800),
  cookieName: z.string().default("dsh_auth"),
});

export interface AuthService {
  sessions: SessionStore | undefined; // storageDomain 缺失时为 undefined（D3）
  gate: Gate;                         // 可写：M2 换流、测试注入假门
}

declare module "@deepseek-ai/cordis" {
  interface Context { auth?: AuthService; }
}

export function apply(ctx: Context, config: AuthConfig): void { ... }
```

`apply` 接线骨架（照此实现，勿改顺序）：

1. `const server = ctx.get("webServer") as unknown as WrappableServer | undefined;` 为 `undefined` 则 `return`（inject 已保证存在，防御性短路）。
2. `const log = ctx.logger("dsh-auth");`
3. `const auth: AuthService = { sessions: undefined, gate: noopGate }; ctx.provide("auth", auth);`
4. 会话层（软接 storageDomain）：
   `const storageDomain = ctx.get("storageDomain") as unknown as DomainFacility | undefined;`
   - 缺失：`log.error("storage-domain is unavailable: session persistence is disabled (guards stay mounted)");`
   - 存在：`ctx.effect(() => { let closed = false; const opening = storageDomain.open(sessionDomainSpec); const ready = opening.then((domain) => { if (closed) { void domain.close(); return; } auth.sessions = new SessionStore(domain.table("sessions")); log.info("session domain opened: dsh_auth_sessions"); }, (error: unknown) => { log.error(`session domain open failed: ${error instanceof Error ? error.message : String(error)}`); }); return async () => { closed = true; await ready.catch(() => undefined); const domain = await opening.catch(() => undefined); await domain?.close(); }; }, "dsh-auth: session domain");`
     （注意：`ready` 挂 `.then` 后解析为 `void`，disposer 必须从**原始** `opening` promise 取 domain 来 close，否则 domain 泄漏。）
5. 守卫：`const unwrap = wrapServer(server, () => auth.gate, log); ctx.effect(() => unwrap, "dsh-auth: guard unwrap");`
   （effect 逆序注销保证：先撤守卫，后关 domain。）
6. 自检：`const failures = assertGuarded(server); if (failures.length > 0) { for (const f of failures) log.error("unwrapped entry: " + f); throw new Error("dsh-auth: guard self-check failed: " + failures.join(", ")); }`

其他约定：不记录/输出 config 中的任何敏感值（M1 的 config 无敏感值，但日志只打事件名与路径，不打 token）。`AuthService`/`AuthConfig` 导出的类型只引用自身定义与 `SessionStore`/`Gate`（自包类型），不泄漏 storage-domain/webserver 包类型到公开 d.ts。

---

## 5. 测试矩阵

全部用 Vitest，显式 import（`import { describe, expect, it, beforeAll, afterAll } from "vitest"`），
环境 node。既有 `src/index.test.ts` **整体重写**为下述用例。覆盖率红线 80%（branches/functions/
lines/statements）照常适用。

### 5.1 单元测试

**`src/gate.test.ts`** — `noopGate.decide` 对任意参数返回 `"allow"`（1 个用例）。

**`src/guard.test.ts`** — 本文件内定义 `makeFakeServer(): WrappableServer`（Map 表 + 记录调用次数的
register/registerUpgrade/registerFallback，返回删除用 disposer），假 `req/res/socket` 为最小对象
（`res: { headersSent, setHeader, writeHead, end }`、`socket: { write, destroy }` 记录调用）。用例：

1. 存量包装：四表 + fallback 的 handler 均被替换（引用不等）且 `isGuarded` 为真；allow 时原 handler 以原参数被调用。
2. 增量包装：wrap 之后 `server.register(route)` 注册的 handler 带守卫；deny 时原 handler 不被调用且收到 401。
3. 幂等：`wrapServer` 调两次，handler 只包一层（第二次返回同一 unwrap）；unwrap 后四表/方法/fallback 与包装前逐引用相等。
4. 拒绝-HTTP：`GET` + `Accept: text/html` → `writeHead(302)` 且 `location === "/auth/login?next=%2Fsome%2Fpath"`、`cache-control: no-store`；非导航（`Accept: application/json` 或 `POST`）→ `writeHead(401)`、body `unauthorized`。
5. 拒绝-升级：deny → `socket.write` 收到以 `HTTP/1.1 401 Unauthorized` 开头的内容、`socket.destroy` 被调、原 handler 未被调；allow → 原 handler 收到 `(req, socket, head)`。
6. 错误传播：原 handler reject 时守卫不捕获（`await expect(...).rejects.toThrow`）。
7. gate 访问器：先 deny 门 → 401；把门换成 allow → 200 路径（证明运行时换门生效）。

**`src/session-store.test.ts`** — 文件内 `class MemTable implements KvTable<string, Session>`（Map 实现）。
用例：

1. `digestToken` 已知向量：`digestToken("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`。
2. `create`：token 匹配 `/^[A-Za-z0-9_-]{43}$/`；行已 `put`，键 = digest，`createdAt/expiresAt` 差值 = ttlMs，`revoked === false`，`subject` 透传。
3. `getByToken`：有效 token → 返回行；未知 token → `undefined`；已过期（`expiresAt <= Date.now()`）→ `undefined`；`revoked: true` → `undefined`。
4. `revokeByToken`：存在 → `true` 且行删除；不存在 → `false`。
5. `pruneExpired`：混合有效/过期行，只删过期、返回精确计数、有效行原样保留。
6. `buildSetCookie` 精确串：`buildSetCookie("dsh_auth", "tok", 604800) === "dsh_auth=tok; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax"`。

**`src/self-check.test.ts`** — 复用 guard.test.ts 的 fake（提取到测试内共享 helper 或复制实现；**不得**建 src 运行时 helper 只为测试）。用例：

1. 全包装 server → `[]`。
2. 某 exact 项未包装 → 包含 `"exact <path>"`；fallback 未包装 → `"fallback"`；方法未替换 → `"method register"`。

**`src/index.test.ts`** — 假 ctx（`{ get, provide, logger, effect }` 记录调用，effect 存储 disposer）。用例：

1. 形状：`name === "dsh-auth"`；`inject` 含 `"webServer"`。
2. 无 webServer：`apply` 静默返回（不抛、不 provide）。
3. 有 webServer + 无 storageDomain：守卫生效（fake server 被包装）、`auth.sessions === undefined`、`log.error` 被调用一次、不抛。
4. 有 webServer + 有 storageDomain（fake `{ open }`，open 返回带 `table/close` 的假 Domain，resolve 时延）：apply 返回后 microtask 冲洗，`ctx.get("auth").sessions` 为 `SessionStore` 实例。
5. 自检失败传播：webServer 未包装场景被破坏（如 fake server 的 register 方法在 wrap 后仍不带标记——直接改回原始方法）→ apply 抛 `dsh-auth: guard self-check failed` 且 `log.error` 含条目名。
6. 注销：逐个调用 effect disposer（逆序），守卫已还原（fake server 表项恢复原 handler 引用）、domain.close 被调用。
7. Config 默认值：`Config` 校验 `{}` → `{ mode: "token", sessionTtl: 604800, cookieName: "dsh_auth" }`（schemastery 的 `Config(...)` 校验调用，失败即测试失败）。

### 5.2 集成测试（真实入口路径——§7 回归纪律的根基）

**`src/integration.guard.test.ts`** — 真实 cordis + 真实 WebServer + 真实 HTTP：

```ts
import { Context } from "@deepseek-ai/cordis";
import WebServer from "@deepseek-ai/dsh-host-webserver";
import { apply, inject, name, Config } from "./index.js";
import type { Gate } from "./gate.js";
```

1. setup：`new Context()`；`const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 })`；
   取 `const server = ctx.get("webServer")`（断言存在，类型用 `as unknown as` 缩小）；注册
   exact `/probe`（200 `"probe"`）、prefix `/pfx`（200 `"pfx"`）、fallback（200 `"spa"`）；
   再 `const authFiber = await ctx.plugin({ name, inject, apply, Config }, {})`；
   `const port = server.port`。
2. NoopGate 放行：`fetch(http://127.0.0.1:${port}/probe)` → 200 `probe`；`/pfx/x` → 200 `pfx`；`/` → 200 `spa`。
3. 换 deny 门：`const denyGate: Gate = { decide: () => "deny" }; ctx.get("auth")!.gate = denyGate;`
   - `fetch("/probe", { headers: { accept: "text/html" } })` → 302，`location === "/auth/login?next=%2Fprobe"`；
   - `fetch("/probe", { headers: { accept: "application/json" } })` → 401，body `unauthorized`；
   - `fetch("/pfx/x")` → 401（前缀路由也被守）；
   - `fetch("/")` → 302（fallback 被守）。
4. WS 拒绝：`node:http` 的 `request({ port, host: "127.0.0.1", path: "/api/events.host", headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==", "Sec-WebSocket-Version": "13" } })`：
   期待 `response` 事件、状态 401，**不**触发 `upgrade` 事件（guard 在 ws 协商前拒绝）。
5. apply 顺序无关：dsh-auth 挂载**之后**再 `server.register({ kind: "exact", path: "/late", handler })` → 立即被守（fetch → 401/302）。
6. teardown：`await authFiber.dispose(); await wsFiber.dispose();` 后对 port 的请求连接被拒（可断言 fetch rejects）。

**`src/integration.session.test.ts`** — 真实 storage 栈 + 跨重启持久化：

```ts
import Storage from "@deepseek-ai/dsh-storage";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
```

1. `mkdtemp` 建临时 root；ctx1：依次 `ctx.plugin(Storage)`、`ctx.plugin(storageJson, { root })`、
   `ctx.plugin(storageDomain, { backend: "json" })`、再挂本插件（无 webserver 也可——`inject` 只含
   webServer，故 ctx1 也挂 WebServer `{ host: "127.0.0.1", port: 0 }`），保留全部 Fiber。
2. `await` 一个小轮询（≤5s，50ms 间隔）直到 `ctx1.get("auth")!.sessions !== undefined`。
3. `const { token } = await store.create("token", 60_000)`；断言 `getByToken(token)` 返回行；断言
   `<root>/dsh_auth_sessions.json` 存在且内容含 digest 键（读文件、`JSON.parse`、
   断言 `doc.tables.sessions[digest]` 存在——文件结构见 §2.2）。
4. 逆序 dispose ctx1 全部 Fiber。
5. ctx2：同一 root、同一栈、同样等待 sessions ready；`getByToken(token)` 返回相同 `subject` 与
   `expiresAt`（**跨"重启"持久化成立**）。
6. teardown：dispose + `rmSync(root, { recursive: true, force: true })`。

> 若测试失败且失败原因是某 harness 包行为与本文件不符：**停下报告差异**，不要改测试去迁就。

---

## 6. 实施顺序（按序执行，每步保持 `npm run verify` 可绿）

1. `package.json` 依赖变更 + `npm install --registry=https://registry.npmjs.org/`。
2. `src/gate.ts` → `src/gate.test.ts`（先绿）。
3. `src/guard.ts` → `src/guard.test.ts`。
4. `src/session-store.ts` → `src/session-store.test.ts`。
5. `src/self-check.ts` → `src/self-check.test.ts`。
6. `src/index.ts`（重写，替换现有骨架）→ `src/index.test.ts`（重写）。
7. 集成测试两个文件（最后写：依赖前五步稳定）。
8. `docs/specs/development.md` 的 `## Structure` 树更新为：
   ```
   src/
   ├── index.ts          # plugin entry: name / inject / Config / apply + auth 服务接线
   ├── guard.ts          # webServer 路由/升级/fallback 包装与拒绝管线
   ├── gate.ts           # Gate 词表 + noopGate（M2 换真门）
   ├── session-store.ts  # storage-domain 会话持久化
   ├── self-check.ts     # 包装覆盖自检（fail loud）
   ├── *.test.ts         # 单元测试（显式 vitest import）
   └── integration.*.test.ts  # 真实 cordis/webserver/storage 栈集成测试
   ```

---

## 7. Definition of Done（全部满足才算完成）

1. `npm run verify` 全绿（format:check + lint + type-check + test:coverage ≥80% + lock:check）。
2. `npm run build` 成功且 `lib/` 已重新生成；`git status` 中 `src/` 与 `lib/` 同批改动（AGENTS.md 提交纪律，未获指令**不 commit 不 push**）。
3. `npm run test -- src/integration.guard.test.ts src/integration.session.test.ts` 单独跑也绿。
4. 报告中列出：改动文件清单、每个冻结决策（D1–D16）的落点文件、覆盖率数字、任何与本文档不一致之处（应为零；有则视为未完成）。

---

## 8. 禁区清单（违反 = 返工）

- **不探索 harness 内部**：只信本文档 §2 的事实。需要新事实 → 停下报告。
- **不发明 API**：`webServer` 没有中间件/事件钩子；storage 只有 §2.2 列出的接口。
- **不吞错误**：handler 错误向上抛；`open` 失败走 `log.error` 分支后守卫仍挂载（D3）。
- **不留副作用**：所有注册（wrap、domain、provide 由 fiber 自动注销）必须有对应 effect/disposer。
- **不写 `console.*`**（src 内 lint 报 error）；日志统一 `ctx.logger("dsh-auth")`。
- **不落敏感值进日志/测试快照**：token 只在内存与响应中出现；测试断言用已知向量，不 print 真实随机 token。
- **不改门禁**：不得降 coverage 阈值、不得加 eslint-disable（除文件内既有允许项）、不得改 tsconfig/eslint/vitest 配置。
- **不改依赖之外的 package.json 字段**（version 由 release-please 管，scripts/files/exports 不动）。
- **不动其他里程碑**：M2+（token 校验、登录页、users.yaml、TOTP、CLI、`cordis.patch.yml`/profile 行文档）不在 M1。写代码时如需要引用，只做 TODO 注释并带稳定 tag（如 `TODO(auth-token-gate):`）。
- **分支纪律**：所有改动留在 `development`，不碰 `main`，未获指令不 commit/push。

---

## 9. 明确不做（M1 范围之外，勿实现）

- 登录页与 `/auth/*` 端点、Bearer/token 校验、credentials 引用（M2）。
- users.yaml / argon2id / 限速 / `dsh-auth user` CLI（M3）。
- TOTP 两段式登录（M4）。
- 部署侧交付物：`cordis.patch.yml` 生产 patch、profile 行文档、部署验收清单（M1 代码交付后单独做）。
- client 半边（登出按钮等 GUI 组件）。
