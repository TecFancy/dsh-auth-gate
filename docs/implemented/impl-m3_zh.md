# dsh-auth M3 实施规格（executable spec）

> 读者：执行实现的编码代理（预期 deepseek v4 flash，**新 session**）。本文档是**决策完备的规格**：
> 所有判断点已预先关闭，执行者只做翻译，不做设计。
> 基线：`docs/implemented/impl-m2_zh.md`（M2 已交付：守卫 + TokenGate + /auth 端点 + 持久化会话——M3 在其上叠加）。
> 设计依据：`docs/specs/dsh-auth-plan_zh.md` §5/§6 阶段 2/§8；工程门禁：`docs/specs/development.md`。
> **本文件是 M3 的唯一权威细则**；与 plan/M1/M2 冲突时以本文件为准。
>
> 环境与验证工作流见 `docs/handoff/handoff-m2_zh.md`（新 session 必读：服务器访问、沙箱网络限制、M1/M2
> 踩坑清单——§3/§4/§5 的环境事实对 M3 依然有效）。**禁止自行探索 harness 内部**——需要本文件
> 之外的事实，停下报告。
>
> 已获用户确认的两个方向性决策（2026-08-15）：口令哈希用 **`node:crypto` scrypt**（零新增
> 原生依赖）；password 模式下 **Bearer = 会话 token**（非共享 token、非 Basic）。

---

## 1. M3 目标

把阶段 2 的"真正登录"落地，`mode: "password"` 从抛错变为完整可用的密码流：

- `$DSH_HOME/auth/users.yaml` 维护管理员凭证（scrypt 哈希，**文件里永不出现明文口令**）；
- `POST /auth/login` 接受 `username` + `password`，恒时验证 → 发持久化会话 cookie（subject =
  用户名，审计用）；错误口令/未知用户/禁用用户统一 401（防枚举）；
- 登录限速：按 IP + 账号双桶计数，失败指数退避，锁定返回 `429 + retry-after`；
- `Authorization: Bearer <会话 token>` 直接通过守卫（会话查表校验，零每请求 KDF）；
- 配套 CLI：`dsh-auth user add/list/disable`（生成哈希、原子编辑 users.yaml）；
- `mode: "token"`（M2 行为）**保持 100% 不变**，作为默认流继续可用。

守卫/会话/自检全部复用 M1/M2，**不改其行为**；本里程碑只加密码流 + CLI。

---

## 2. 冻结决策表（M3 增量；M1 的 D1–D16、M2 的 M1–M22 不变）

| #   | 决策           | 冻结值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | 口令哈希       | `node:crypto` **scrypt**（`promisify(scrypt)`），参数 **N=65536, r=8, p=1, keylen=32**，salt = `randomBytes(16)`，**显式 `maxmem: 128 * 1024 * 1024`**（本机实测：N=2¹⁵ 即超过默认 32 MiB maxmem 直接抛 RangeError，必须显式传）。存储为单字符串 `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`。单次派生 ~150 ms，登录低频可接受                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P2  | 验证语义       | `verifyPassword(password, stored)` 解析 stored 的 N/r/p/salt/hash 后按**存储值**的参数重新派生（当前值即 P1，未来调参时旧哈希仍可验证）；N ≤ 2¹⁷、r ≤ 32、p ≤ 4（防 users 文件恶意参数放大内存），salt 段解码 16 字节、hash 段 32 字节，段数/前缀/数字不合法 → `false`（**不抛**）。恒时：`timingSafeEqual`（双方恒 32 字节 Buffer）                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P3  | DUMMY_HASH     | 冻结字面量：`scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k`（salt = 16 个 0x7a 字节；口令 `dsh-auth-dummy-password-for-timing-uniformity` 仅出现在测试断言中，**不是秘密**）。未知用户名登录时对该常量跑一次真验证（时序均匀，防用户名枚举）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P4  | users 文件格式 | `$DSH_HOME/auth/users.yaml`：顶层 `{ version: 1, users: { <name>: { passwordHash, totpSecret?, disabled? } } }`。zod 严格校验：顶层与用户条目都 `.strict()`——未知键/`version` 非 1/非法用户名/缺失 `passwordHash` → 文件不可用（503）。`totpSecret`（可选 string）**M3 只解析不使用**（M4）；`disabled` 缺省 `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P5  | username 约束  | `USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/`（users 文件校验 + CLI 强制）；匹配**大小写敏感**、不做任何规范化。用户名仅作键与审计 subject，不是身份边界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P6  | 文件路径       | config 新增 `usersFile: string`，默认 `""`。`""` 时 apply 内解析：`process.env.DSH_HOME` 存在 → `path.join(env, "auth", "users.yaml")`；否则 `path.join(os.homedir(), ".dsh", "auth", "users.yaml")`（与部署侧 `DSH_HOME=~/dsh-smoke` 启动方式一致，handoff §3.2）。显式 config 原样使用。解析规则是本插件自己的，README 注明                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P7  | 读取语义       | **每次登录尝试重新读文件**（per-operation，CLI 改完立即生效、免重启——与 M2 credentials 语义一致）；**不缓存**。YAML 语法错/schema 错/权限过宽 → 登录 503 `"user store unavailable"` + `log.error`（每次失败都记——登录低频，操作员信号）；文件不存在 → **空用户集** + 进程内首次 `log.warn` 一次（flag 防刷）+ 登录走 401 路径                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P8  | 文件权限       | 与 credentials 的 0600 纪律一致：POSIX 上加载时 `(stat.mode & 0o077) !== 0` → 文件不可用（503）；**win32 跳过检查**（权限无意义，CI 有 windows-latest）。CLI 写入一律 0600（P19）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P9  | 认证结果       | 未知用户 → 对 DUMMY_HASH 验证后 401；口令错误 → 401；`disabled: true` → **仍跑一次真验证**（时序均匀）后 401。三者响应体统一 `"invalid credentials"` + `logger.info("login rejected")`（**不含用户名**——防枚举，日志纪律 P23）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P10 | 登录限速       | 内存态 `LoginRateLimiter`（**重启清零**，README 注明）。常量：`maxFailures=5`、`baseDelaySeconds=30`、`maxDelaySeconds=900`、`windowSeconds=600`；第 n（n≥5）次失败 → 锁定 `min(30 * 2^(n-5), 900)` 秒。锁定期请求 → **429** + `retry-after: <秒>` + text/plain `"too many attempts"` + `logger.info("rate limit exceeded")`，**不增计数、不验证**；锁到期条目清零重计；**失败计数 10 分钟无失败后衰减清零**（滑动窗口，`windowSeconds`）；成功清双桶。IP 取 `req.socket.remoteAddress ?? ""`，**不读 XFF**（可伪造）；`username === ""` 只计 IP 桶；条目上限 10000，超限删最早插入                                                                                                                                                                                                |
| P11 | mode 语义      | `mode: "password"` 激活 PasswordGate + password 端点（**不再抛错**）；`mode: "token"` 为默认且行为与 M2 **逐字节一致**（`token-gate.ts` 零改动、credentials 接线零改动）。两模式**二选一不可并存**；password 模式不读 credentials 服务、`tokenRef` 配置被忽略                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P12 | PasswordGate   | `decide` 顺序：1) 白名单 `/auth`、`/auth/*` → allow；2) cookie：`parseCookieHeader` 非空且 `sessions()?.getByToken(...)` 命中 → allow；3) **Bearer = 会话 token**：`Authorization` 匹配 `/^Bearer\s+(.+)$/i` 后 `sessions()?.getByToken(value)` 命中 → allow（**不比对共享 token、不派生哈希**）；4) deny。同步返回（无 await）。HTTP 与 upgrade 同一 `decide`（guard 侧不变）                                                                                                                                                                                                                                                                                                                                                                                                     |
| P13 | 登录页         | `login-page.ts` 新增 `passwordLoginPageHtml(next, error?)`：username（`<input type="text" name="username" autocomplete="username" required>`）+ password（`<input type="password" name="password" autocomplete="current-password" required autofocus>`）+ hidden next（escape）+ 同款内联样式。`loginPageHtml`（token 版）原样保留。`GET /auth/login` 恒渲染（不查会话、不重定向，M20 一致）                                                                                                                                                                                                                                                                                                                                                                                       |
| P14 | 登录端点       | `POST /auth/login`（password 模式）字段 `username`/`password`/`next`，复用 `parseFormBody`（415/413 语义与 M2 完全一致）。成功 → `store.create(username, ttl*1000)` + `buildSetCookie` 4 参 + 302 next + `info("session issued")`。失败 → 401 `"invalid credentials"`；`loadUsers` 失败 → 503 `"user store unavailable"` + `error`；`sessions()` undefined → 503 `"session store unavailable"` + `error`（M2 文案）。429 见 P10。全程 no-store                                                                                                                                                                                                                                                                                                                                     |
| P15 | 会话语义       | subject = **username**（审计：日志知道哪个凭证产生的会话；不是隔离）。**禁用用户只拦新登录**：已发会话在 TTL 内继续有效（README 注明局限；`revokeBySubject` 留 M4 评估，写 `TODO(auth-m4):`）。每次登录都是新会话（防固定，M6 语义延续）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P16 | 路由模型       | password 模式注册**同样的 4 条**（prefix `/auth` 404 兜底 + 3 exact），由 `index.ts` 按 mode 二选一装配（不同时注册两条相同 path——webserver 会抛重复）。logout/status 行为与 M2 **完全一致**：logout 仅 POST、next 仅 query、无 body 可幂等调用、`Max-Age=0`；status 仅 GET、**只认 cookie**（Bearer 会话 token 不参与——无状态通道不建会话）                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P17 | validateNext   | 提取到新文件 `src/auth-common.ts` 导出；`auth-endpoints.ts` 删私有实现改 import（**行为不变**，M2 测试守护）；`password-endpoints.ts` 同样 import。M8/M20 校验规则逐字保留                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P18 | CLI            | `package.json` 增 `"bin": { "dsh-auth": "lib/cli.js" }`；`src/cli.ts` 首行 shebang（tsc 原样保留）。命令面：`user add <name> [--password-stdin] [--disabled]` / `user list` / `user disable <name>`；全局 `--file <path>`（缺省 `defaultUsersFilePath()`）。`add` **要求 `--password-stdin`**（从 stdin 读一行，去尾部 `\r\n`；缺 flag → usage + exit 1）；name 不符 USERNAME_RE / 已存在 → stderr 错误 + exit 1；成功 `out("user <name> added")`。`list` 按用户名排序输出 `<name>` / `<name> (disabled)`（**永不输出哈希**）。`disable` 幂等（已禁用也成功）。未知命令/参数 → usage 到 stderr + exit 1。成功 exit 0。`main(argv, io): Promise<number>` 可注入 io（`out`/`err`/`readLine`）——**禁 `console.*`**，默认 io 用 `process.stdout/stderr.write` + `node:readline` 读一行 |
| P19 | CLI 写文件     | 经 `writeUsersFile`：`yaml.stringify` 重写**全文件**（注释不保留——README 注明该文件归 CLI 管、勿手写注释）+ 同目录 `<path>.tmp` 写入 + `fs.rename` 原子替换 + mode `0o600`；目录不存在则 `mkdir -p`。序列化时用户按用户名字典序（**显式比较器**——eslint 规则）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P20 | 依赖变更       | runtime 增 **`yaml@^2.9.0`**（本机锁文件已有 2.9.0 传递依赖，公开 npm 源，`lock:check` 通过）；**无其他依赖变化**（devDependencies 不动；scrypt 是内建）。安装必须 `npm install --registry=https://registry.npmjs.org/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P21 | CSRF 评估      | **M3 仍不加登录 CSRF token**。评估结论：单门模型无用户间隔离——登录 CSRF 唯一影响是会话 subject 审计值被污染（受害者以攻击者身份使用同一共享实例），无权限边界损失；`SameSite=Lax` + 现代浏览器第三方 Set-Cookie 限制进一步收窄；README 注明残余风险，M4 再评估。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P22 | 配置面         | M3 唯一新 config = `usersFile`（P6）。限速常量**不配置化**（`rate-limit.ts` 模块常量）；scrypt 参数不配置化。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P23 | 日志纪律       | 延续 M21：**永不落**口令/用户名（登录相关日志）/哈希/会话 token。password 模式日志事件：`login rejected`、`rate limit exceeded`、`session issued`、`logout`（info）；`user store unavailable: <error.message>`、`session store unavailable`（error）；`users file not found: <path>`（warn，进程内一次）。DUMMY_HASH 与 DUMMY 口令是公开常量不受限；CLI 输出（list、add 确认）不是日志                                                                                                                                                                                                                                                                                                                                                                                             |
| P24 | 行数预算       | `password-login.ts`（登录 handler 逻辑，≤250）与 `password-endpoints.ts`（路由骨架 + logout/status + 405，≤250）拆两个文件。测试沿 M2 教训拆三个文件（矩阵 §5）。`cli.ts` 单文件 ≤250（usage 文本作文件内常量）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P25 | 测试参数       | 单测/集成测试一律用**真实 scrypt 参数**（不弱化、不注入假参数）；密码类套件预算 ≤10 次派生（每次 ~150 ms）。429 锁定（30s 起）会污染同实例后续登录——**429 场景用独立 ctx/端口实例**（集成测试单独 describe 起新栈），单测用注入时钟 `now`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P26 | 装配顺序       | `apply` 内：log → mode 分支（token：`makeTokenResolver` + TokenGate；password：PasswordGate + `usersPath` 解析 + `new LoginRateLimiter()` + `loadUsers`/`verify` 闭包）→ auth 对象一步成型（`sessions: () => auth.sessions` 闭包自引用）+ `provide` → storage 软接（M1 逻辑不动）→ `wrapServer` → 端点注册（按 mode 二选一，包装后的 `server.register`）→ 自检（最后）。apply 内无 await；password 模式**不访问 credentials 服务**                                                                                                                                                                                                                                                                                                                                                 |

---

## 3. 权威契约（M3 新增事实；其余见 impl-m1.md §2 / impl-m2.md §3）

### 3.1 `node:crypto` scrypt（本机 Node 24.13.1 实测）

- `scrypt(password, salt, keylen, options)` 回调式；用 `promisify(scrypt)`。
- **maxmem 实测**：默认 maxmem = 32 MiB；N=32768/r=8 即抛
  `RangeError: Invalid scrypt params ... memory limit exceeded`——**必须显式 `maxmem`**（P1 冻结
  128 MiB；N=65536/r=8 需要 64 MiB 工作内存，留余量）。
- N=65536/r=8/p=1/keylen=32 实测 ~150 ms/次。
- `timingSafeEqual` 只接受 Buffer/TypedArray（M2 已冻结，scrypt 输出即 Buffer，双方恒 32 字节）。
- base64url 长度：16 字节 salt → 22 字符；32 字节 hash → 43 字符。存储串总长固定，格式正则
  `/^scrypt\$65536\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/`（当前参数下的形状断言用）。

### 3.2 `yaml` 包（v2.9.0，公开 npm，已在本仓库锁文件传递依赖中）

- `import { parse, stringify } from "yaml"`；`parse` 返回 `unknown`（不信任输入，一律过 zod 校验）；
  `stringify` 默认 2 空格缩进、LF。仅用这两个 API，不用 schema/anchors 高级特性。
- `parse` 对重复键默认**报错抛异常**（YAML 1.2 默认）——正是我们要的严格行为（重复用户名 = 文件
  不可用）；测试覆盖。

### 3.3 路径与进程环境

- `process.env.DSH_HOME`：部署侧以 `DSH_HOME=~/dsh-smoke <dsh>` 方式启动（handoff §3.2 已验证的
  机制）；本插件**只读**该变量做 P6 默认路径解析，不探索/不依赖 harness 的任何其他环境事实。
- `os.homedir()` 兜底（跨平台）；CLI 与插件共享同一个 `defaultUsersFilePath()` 实现
  （`users-file.ts`），保证 CLI 缺省 `--file` 与插件默认路径一致。

### 3.4 不探索

沿用 M1/M2 纪律：需要本文件未出现的事实（字段、签名、行为）→ 停下报告，不得猜测。

---

## 4. 文件蓝图

每个文件 ≤250 行、函数 ≤80 行、复杂度 ≤15（ESLint error）。M2 文件改动只有三处：
`auth-endpoints.ts`（P17 import）、`login-page.ts`（新增一个导出）、`index.ts`（P26 装配）。
`token-gate.ts` / `cookie.ts` / `form-body.ts` / `guard.ts` / `gate.ts` / `session-store.ts` /
`self-check.ts` **零改动**。

### 4.1 `src/password.ts` —— scrypt 哈希与恒时验证

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
export const SCRYPT_N = 65536;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 32;
export const SCRYPT_MAXMEM = 128 * 1024 * 1024;
/** 未知用户登录时的占位哈希（P3）：salt=16×0x7a 的固定常量，验证成本与真用户一致。 */
export const DUMMY_HASH =
  "scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k";

/** 生成 `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`（salt 16 字节随机）。 */
export async function hashPassword(password: string): Promise<string>;

/** 恒时验证：解析 stored 参数后重派生（P2），格式/参数非法 → false，不抛。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean>;
```

行为约定：`hashPassword` 先 `randomBytes(16)` 再 `scrypt`，拼接用当前常量参数。`verifyPassword`
先 `stored.split("$")`：6 段、段 0 === `"scrypt"`、N/r/p 为正整数且 N ≤ 2¹⁷、r ≤ 32、p ≤ 4、
salt/hash 段 base64url 解码后 16/32 字节——任一不满足 → `false`；按**解析出的**参数
`scrypt(password, salt, 32, { N, r, p, maxmem: SCRYPT_MAXMEM })` 后 `timingSafeEqual`。派生异常
（内存不足等）→ catch 后 `false`。

### 4.2 `src/rate-limit.ts` —— 双桶登录限速

```ts
export interface RateLimitOptions {
  maxFailures?: number; // 默认 5
  baseDelaySeconds?: number; // 默认 30
  maxDelaySeconds?: number; // 默认 900
  windowSeconds?: number; // 默认 600：失败计数衰减窗口（见下）
  now?: () => number; // 默认 Date.now；测试注入
}

export type RateLimitCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class LoginRateLimiter {
  constructor(options?: RateLimitOptions);
  check(ip: string, account: string | undefined): RateLimitCheck;
  recordFailure(ip: string, account: string | undefined): void;
  recordSuccess(ip: string, account: string | undefined): void;
}
```

行为约定：

- 内部两个 `Map<string, { failures: number; lockUntil: number; lastFailureAt: number }>`
  （`byIp` / `byAccount`）；`account === undefined || account === ""` 时只动 IP 桶。
- `check`：任一桶 `lockUntil > now` → `{ allowed: false, retryAfterSeconds: max(1, ceil((lockUntil-now)/1000)) }`
  （取两桶最大）；`lockUntil <= now` 且 failures > 0 → 清零（锁到期自然重试）；**失败衰减**：
  failures > 0 且 `now - lastFailureAt > windowSeconds * 1000` → 清零（1–4 次失败 10 分钟无后续
  失败即遗忘，防慢泄漏）；同时修剪：删除 `failures === 0` 的条目；总条目数 > 10000 → 删除
  **最早插入**的（Map 迭代序）直到 ≤ 10000。
- `recordFailure`：对应桶 `failures++`、`lastFailureAt = now`；若 `failures >= maxFailures` →
  `lockUntil = now + min(baseDelay * 2 ** (failures - maxFailures), maxDelay) * 1000`。
- `recordSuccess`：删除对应桶条目。
- 端点锁定期**不调** `recordFailure`（429 短路，P10）——锁定时长由失败序列决定，不被延长。

### 4.3 `src/users-file.ts` —— users.yaml 加载/校验/原子写

```ts
import { z } from "zod";
import { parse as parseYaml, stringify } from "yaml";

export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export interface UserRecord {
  passwordHash: string;
  totpSecret?: string; // M3 解析不使用（M4）
  disabled: boolean;
}

export interface UsersSnapshot {
  users: Map<string, UserRecord>;
}

/** users 文件不可用（语法/schema/权限）。message 面向操作员，可落日志。 */
export class UsersFileError extends Error {}

/** 加载结果：`missing` 区分"文件不存在"与"文件存在但无用户"（供 warn-once，P7）。 */
export interface UsersLoadResult {
  snapshot: UsersSnapshot;
  missing: boolean; // ENOENT → true（快照为空）；解析/权限失败 → throw，不走此通道
}

/** P6：DSH_HOME env → ~/.dsh/auth/users.yaml。 */
export function defaultUsersFilePath(): string;

/** 每次登录现读（P7）。ENOENT → `{ snapshot: 空, missing: true }`（不抛）；否则 P7/P8 失败语义。 */
export async function loadUsersFile(path: string): Promise<UsersLoadResult>;

/** CLI 用：全量序列化 + 原子替换 + 0600（P19）。 */
export async function writeUsersFile(path: string, snapshot: UsersSnapshot): Promise<void>;
```

行为约定：

- `loadUsersFile`：`fs.stat` → ENOENT → 返回 `{ snapshot: 空快照, missing: true }`（**不抛**）；
  POSIX 且 `(mode & 0o077) !== 0` →
  throw `UsersFileError("users file has insecure permissions: <path>")`；win32 跳过权限检查。
  `readFile("utf8")` → `parseYaml` → zod 校验。zod schema（v4，`z.object({...}).strict()` 顶层与
  用户条目都 strict）：
  ```ts
  const userRecordSchema = z
    .object({
      passwordHash: z.string().min(1),
      totpSecret: z.string().optional(),
      disabled: z.boolean().optional(),
    })
    .strict();
  const usersFileSchema = z
    .object({
      version: z.literal(1),
      users: z.record(z.string(), userRecordSchema),
    })
    .strict();
  ```
  解析/校验失败 → throw `UsersFileError(<yaml 或 zod 的消息前缀 "invalid users file">)`；
  用户名逐一 `USERNAME_RE` 校验（`superRefine` 或 load 后循环）——非法即 throw。成功后
  `Map`（`disabled` 补 `false`），返回 `{ snapshot, missing: false }`。yaml parse 抛错（含重复键）
  → 同样包装为 `UsersFileError`。
- `writeUsersFile`：`mkdir(dirname, { recursive: true })` → `stringify({ version: 1, users: 对象 })`
  （用户按用户名字典序，**显式比较器** `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`）→
  `writeFile(path + ".tmp", text, { mode: 0o600 })` → `rename` → 目标路径。幂等可重复调用。

### 4.4 `src/password-gate.ts` —— password 模式门

```ts
import type { IncomingMessage } from "node:http";
import type { Gate, GuardKind } from "./gate.js";
import type { SessionStore } from "./session-store.js";
import { AUTH_PATH_PREFIX } from "./guard.js";
import { parseCookieHeader } from "./cookie.js";

export interface PasswordGateOptions {
  sessions: () => SessionStore | undefined; // M16 同形访问器
  cookieName: string;
}

export class PasswordGate implements Gate {
  constructor(options: PasswordGateOptions);
  decide(req: IncomingMessage, kind: GuardKind, pathname: string): "allow" | "deny";
}
```

`decide` 顺序照 P12 实现（白名单 → cookie 会话 → Bearer 会话 token → deny）；**同步返回**，无
async、无 KDF、无文件 IO。`sessions()` 返回 undefined 时 cookie 与 bearer 通道都跳过 → deny
（与 M2 一致：会话层不可用时门恒 deny，白名单除外）。`kind` 参数沿用 `Gate` 接口（password 门
不使用，签名一致）。

### 4.5 `src/auth-common.ts` —— 端点共享纯函数

```ts
/** M8+M20 逐字保留：单个 `/` 开头、非 `//`、无 `\`、非 /auth*；否则回落 `/`。 */
export function validateNext(next: string): string;
```

仅此一个导出。`auth-endpoints.ts` 删掉私有实现（L176–187），改 `import { validateNext } from "./auth-common.js"`；
`queryOf`/`methodNotAllowed` 留在各自文件（不提取）。本文件无独立测试文件——由两端点套件覆盖
（覆盖率达标即可）。

### 4.6 `src/login-page.ts` —— 新增 password 变体

```ts
/** password 模式登录页：username + password 两字段（P13）；next/error 全部 HTML-escape。 */
export function passwordLoginPageHtml(next: string, error?: string): string;
```

复用文件内 `escapeHtml` 与同款样式块（可提取文件内私有模板函数，但导出只增这一个）。token 版
`loginPageHtml` **原样保留**。标题与按钮文案 `Sign in`（区别于 token 版 `Unlock`）。

### 4.7 `src/password-login.ts` —— POST /auth/login 处理逻辑

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionStore } from "./session-store.js";
import type { UsersLoadResult, UsersSnapshot } from "./users-file.js";
import type { LoginRateLimiter } from "./rate-limit.js";

export interface PasswordLoginDeps {
  sessions: () => SessionStore | undefined;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number; // 秒
  usersPath: string; // 仅用于"文件缺失"warn 消息（P23）
  loadUsers: () => Promise<UsersLoadResult>; // index.ts 注入 loadUsersFile(usersPath) 闭包
  verify: (password: string, storedHash: string) => Promise<boolean>; // 与 verifyPassword 同形，index.ts 直接注入
  limiter: LoginRateLimiter;
  logger: {
    error(message: unknown): void;
    info(message: unknown): void;
    warn(message: unknown): void;
  };
}

/** POST /auth/login（password 模式）。完成全部响应写出（含 415/413/401/429/503/302）。 */
export async function handlePasswordLogin(
  deps: PasswordLoginDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>;
```

流程照此实现（顺序冻结，不得重排）：

1. `parseFormBody(req)`——带 `status` 的错误（415/413）→ 写对应响应（413 先
   `res.setHeader("connection", "close")`，M19 复刻）；**不带 `status` 的异常向上抛**。
2. `username = params.get("username") ?? ""`；`password = params.get("password") ?? ""`；
   `next = validateNext(params.get("next") ?? "/")`；`ip = req.socket.remoteAddress ?? ""`。
3. `const check = deps.limiter.check(ip, username === "" ? undefined : username)`；
   锁定 → `429` + `retry-after: <check.retryAfterSeconds>` + text/plain `"too many attempts"` +
   no-store + `info("rate limit exceeded")`；**return（不验证、不增计数）**。
4. `let users: UsersSnapshot; let missing = false;` `try { const loaded = await deps.loadUsers(); users = loaded.snapshot; missing = loaded.missing; } catch (error) {`
   → 503 `"user store unavailable"` + no-store +
   `error("user store unavailable: " + (error instanceof Error ? error.message : String(error)))`；
   **return（系统错误不计失败）**。`}`
   `if (missing && !warnedMissing) { warnedMissing = true; deps.logger.warn("users file not found: " + deps.usersPath + " (all password logins rejected)"); }`
   （`warnedMissing` 为 handlePasswordLogin 模块级 flag——插件单实例，等价进程级一次；P7/P23。）
5. `const user = users.users.get(username);`
   `const ok = await deps.verify(password, user?.passwordHash ?? DUMMY_HASH);`（DUMMY_HASH 从
   `./password.js` import——未知用户时序均匀，P3。**注意参数顺序与 verifyPassword 同形
   `(password, storedHash)`**——TS 结构兼容不检查参数名，顺序写反会在真实路径恒 401，实施时
   已踩并修正）。
6. `if (!ok || user === undefined || user.disabled) { deps.limiter.recordFailure(ip, username === "" ? undefined : username);`
   → 401 `"invalid credentials"` + no-store + `info("login rejected")`；return。`}`。
7. `deps.limiter.recordSuccess(ip, username === "" ? undefined : username);`
8. `const store = deps.sessions();` undefined → 503 `"session store unavailable"` + no-store +
   `error("login failed: session store unavailable")`；return。
9. `const { token: sessionToken } = await store.create(username, deps.sessionTtl * 1000);` →
   `set-cookie`（`buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure)`）
   - 302 `{ location: next }` + no-store + `info("session issued")`。

### 4.8 `src/password-endpoints.ts` —— password 模式路由骨架

```ts
import { AUTH_PATH_PREFIX, type HttpHandler } from "./guard.js";
import { buildSetCookie, type SessionStore } from "./session-store.js";
import { parseCookieHeader } from "./cookie.js";
import { passwordLoginPageHtml } from "./login-page.js";
import { validateNext } from "./auth-common.js";
import { handlePasswordLogin, type PasswordLoginDeps } from "./password-login.js";

export interface PasswordEndpointsDeps extends PasswordLoginDeps {
  /** 注册路由（index.ts 传入包装后的 server.register；被守卫包装但被 gate 白名单放行）。 */
  register(route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): () => void;
}

/** 注册 prefix `/auth` 兜底 + 三个 exact 端点（password 模式）；返回合并 disposer。 */
export function registerPasswordEndpoints(deps: PasswordEndpointsDeps): () => void;
```

结构照 `auth-endpoints.ts`（合并 disposer、track 收集）：4 条路由——

- prefix `/auth` → 恒 404 `"not found"` + no-store（P16）。
- exact `/auth/login`：GET → `validateNext(query.get("next") ?? "/")` + 200 text/html +
  `passwordLoginPageHtml(next)`（恒渲染）；POST → `handlePasswordLogin(deps, req, res)`；
  其他 → 405 + `allow: GET, POST`。
- exact `/auth/logout`：仅 POST（其他 405 + `allow: POST`）——逻辑与 M2 `logout` 逐字一致
  （next 仅 query、revoke 幂等、`buildSetCookie(name, "", 0, cookieSecure)` 清 cookie、302、
  `info("logout")`）。
- exact `/auth/status`：仅 GET（其他 405 + `allow: GET`）——逻辑与 M2 `handleStatus` 逐字一致
  （只认 cookie，Bearer 不参与）。

`methodNotAllowed`/`queryOf`/catch-all handler 在本文件内实现（与 `auth-endpoints.ts` 的对应
函数**内容一致但各自私有**——重复 ~35 行被接受：token 流已冻结、两流生命周期独立；若 M4 需要
合并再动）。全部响应 no-store。

### 4.9 `src/cli.ts` —— dsh-auth 用户管理 CLI

```ts
#!/usr/bin/env node
import { pathToFileURL } from "node:url";
// users-file / password 模块 import 同 src 惯例（相对 .js 后缀）

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readLine(): Promise<string>; // stdin 一行，去尾部 \r\n；EOF → ""
}

/** 返回进程退出码。所有参数/IO 经 argv/io 注入（可测，禁 console.*）。 */
export async function main(argv: string[], io: CliIo): Promise<number>;

// 文件底部入口（保持最后）：
// if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
//   void main(process.argv.slice(2), defaultIo).then((code) => { process.exitCode = code; });
// }
```

行为约定：

- 用法文本（冻结，两处 usage 共用一份常量）：
  ```
  Usage:
    dsh-auth user add <name> --password-stdin [--disabled] [--file <path>]
    dsh-auth user list [--file <path>]
    dsh-auth user disable <name> [--file <path>]
  ```
- 参数解析：`--file` 后跟一个值（原样取用，不做路径展开）；`--disabled`、`--password-stdin`
  为布尔 flag；不认识的 token / 非 `user` 子命令 / 未知子命令 → err(usage) + return 1。
- `add`：name 必须匹配 `USERNAME_RE`（否则 err + 1）；`--password-stdin` 缺失 → err(usage) + 1；
  `(await loadUsersFile(file)).snapshot` → 已存在同名 → err(`user <name> already exists`) + 1；
  `readLine()` 为空 → err(`empty password`) + 1；`hashPassword(pw)` → 加入快照（`disabled` 按
  flag，默认 false）→ `writeUsersFile` → out(`user <name> added`)。
- `list`：`(await loadUsersFile(file)).snapshot` → 按用户名字典序（显式比较器）逐行 out(`<name>` /
  `<name> (disabled)`)。文件缺失（`missing: true`）→ 无输出、exit 0。
- `disable`：`(await loadUsersFile(file)).snapshot` → 不存在 → err(`user not found`) + 1；
  置 `disabled: true` → `writeUsersFile` → out(`user <name> disabled`)（已禁用同输出，幂等）。
- 所有 `loadUsersFile`/`writeUsersFile` 抛错（`UsersFileError` 或 IO）→ err(message) + 1。
- `defaultIo`：`out = (l) => process.stdout.write(l + "\n")`、err 同 stderr、`readLine` 用
  `node:readline` 对 `process.stdin` 取一行后 close。

### 4.10 `src/index.ts` —— 装配变更（P26；其余 M1/M2 逻辑不动）

1. `AuthConfig` 增 `usersFile: string`（注释：`""` = 按 P6 解析默认路径；password 模式专用，
   token 模式忽略）；`Config` 增 `usersFile: z.string().default("")`。`mode` 的 JSDoc 更新为
   "token（M2）/ password（M3）"。
2. **删除** apply 开头的 `mode === "password" → throw`（M2 的 L99–101）。
3. `resolveToken` 仅 token 模式构造（password 模式不构造、不访问 credentials）：
   ```ts
   const resolveToken = config.mode === "token" ? makeTokenResolver(ctx, config, log) : undefined;
   ```
4. password 分支专属常量（token 模式也计算、无害——`usersPath`/`limiter` 都被第 6 步三元表达式
   引用，不算未使用变量；`makeTokenResolver` 惰性取服务，password 模式下从未被调用）：
   ```ts
   const usersPath = config.usersFile === "" ? defaultUsersFilePath() : config.usersFile;
   const limiter = new LoginRateLimiter();
   ```
5. `auth` 一步成型（P26；闭包自引用在 decide 时才求值）：
   ```ts
   const auth: AuthService = {
     sessions: undefined,
     gate:
       config.mode === "password"
         ? new PasswordGate({ sessions: () => auth.sessions, cookieName: config.cookieName })
         : new TokenGate({
             // token 模式下 makeTokenResolver 必返回函数；`??` 兜底仅类型对齐（不可达且 fail-closed）
             resolveToken: resolveToken ?? (async () => undefined),
             sessions: () => auth.sessions,
             cookieName: config.cookieName,
           }),
   };
   ctx.provide("auth", auth);
   ```
6. 端点注册按 mode 二选一（自检仍在端点注册**之后**；token 分支的 `validateToken` 闭包同样用
   `resolveToken ?? (async () => undefined)` 兜底）：
   ```ts
   ctx.effect(
     () =>
       config.mode === "password"
         ? registerPasswordEndpoints({
             register: (route) => server.register(route),
             sessions: () => auth.sessions,
             cookieName: config.cookieName,
             cookieSecure: config.cookieSecure,
             sessionTtl: config.sessionTtl,
             usersPath,
             loadUsers: () => loadUsersFile(usersPath),
             verify: verifyPassword,
             limiter,
             logger: log,
           })
         : registerAuthEndpoints({
             // M2 参数逐字保留：register/sessions/cookieName/cookieSecure/sessionTtl/logger 同上
             validateToken: async (token) => {
               const stored = await (resolveToken ?? (async () => undefined))();
               return stored !== undefined && safeEqual(token, stored);
             },
           }),
     "dsh-auth: auth endpoints",
   );
   ```
7. storage 软接、`wrapServer`、自检：**零改动**（顺序保持：storage → wrap → endpoints → self-check）。

### 4.11 `package.json` / 文档

- `dependencies` 增 `"yaml": "^2.9.0"`（排序按既有字母序）；顶层增
  `"bin": { "dsh-auth": "lib/cli.js" }`。`files: ["lib"]` 已含 CLI 产物；`main`/`exports` 不动。
- `README.md` 新增一节（消费者契约）：`mode: "password"` 配置、users 文件格式与权限（0600、
  归 CLI 管）、CLI 用法、token → password 迁移说明、已知局限（限速内存态重启清零；禁用用户
  不吊销已发会话；无 CSRF token 的残余风险；Bearer 会话 token 语义；XFF 不信任）。
- `docs/specs/development.md` 的 `## Structure` 树按 §4 新文件更新。
- `AGENTS.md` 增两行指针：M3 规格 `docs/implemented/impl-m3_zh.md` + 交接 `docs/handoff/handoff-m3_zh.md`（后者由执行
  session 收尾时写，见 DoD 6）。

---

## 5. 测试矩阵

M1/M2 测试**全保留且必须原样绿**（`auth-endpoints*.test.ts` 不因 P17 改动而变——validateNext
行为不变）。`src/index.test.ts` 按 §4.10 适配。新增（全部显式 vitest import；大套件按 describe
拆文件，每个 ≤250 行）：

**`src/password.test.ts`** —

1. `hashPassword` 输出匹配 `/^scrypt\$65536\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/`；
   两次调用 salt 不同（串不等）。
2. roundtrip：`verifyPassword(pw, await hashPassword(pw)) === true`。
3. 错口令 → false；空串口令 hash/verify 正常（hash("") 可验证）。
4. `verifyPassword` 坏输入全分支：非 6 段、前缀错、N/r/p 非数字、N > 2¹⁷、salt 段长度错、非法
   base64url → 全部 false 且不抛。
5. DUMMY_HASH 已知向量：`verifyPassword("dsh-auth-dummy-password-for-timing-uniformity", DUMMY_HASH) === true`；
   其他口令 → false（DUMMY 口令字面量不是秘密，允许出现在断言）。
6. 参数演进兼容：手工构造合法旧参数哈希（`scryptSync` 按 N=2¹⁴ 生成，拼成
   `scrypt$16384$8$1$<salt>$<hash>`）→ 在模块常量 N=2¹⁶ 下 `verifyPassword` 仍成功（证明验证
   走 **stored 自带参数**而非当前常量；注意 scrypt 的 N 参与派生，**改 N 段必须同时重派生**
   才成立——原"替换 N 段"写法是错的，实施时已修正为上述构造法）。

**`src/rate-limit.test.ts`**（注入 `now`）—

1. 前 4 次失败 → check 恒 allowed。
2. 第 5 次失败后 check → locked，`retryAfterSeconds === 30`。
3. 第 6 次失败后 → 60；增长到 900 封顶（多打几次断言封顶）。
4. 锁定期 check locked（不再 recordFailure）。
5. 时钟越过 lockUntil → check allowed 且计数已清零（失败重新从 1 计）。
6. `recordSuccess` 后 check allowed、计数清零。
7. IP 桶与账号桶独立：同 IP 不同账号失败互不锁定对方；不同 IP 同一账号被账号桶锁定。
8. `account: undefined`/`""` 只动 IP 桶。
9. 衰减与修剪：注入 now——3 次失败后推进时钟 10 分钟 → check 清零且条目被删（后续 check 观察
   不到计数）；条目数超 10000 删最早——上限是模块常量不导出，测试用 10001 个**互异 key** 各
   `recordFailure` 一次（failures=1，不会被普通修剪删掉）灌满后调一次 `check`，断言 Map 大小
   回落到 10000 且最早插入的 key 已被淘汰（各 ~几 ms，可行）。

**`src/users-file.test.ts`**（`mkdtemp` 临时目录；`it.skipIf(process.platform === "win32")` 的
用例用 vitest 条件跳过）—

1. `defaultUsersFilePath`：`vi.stubEnv("DSH_HOME", tmp)` → 拼出 `<tmp>/auth/users.yaml`；
   无 env → `path.join(os.homedir(), ".dsh", "auth", "users.yaml")`（断言前缀 homedir；测试后
   `vi.unstubAllEnvs()`）。
2. load：合法文件（两个用户，一个带 totpSecret/disabled）→ Map 内容正确、disabled 缺省 false。
3. 文件不存在 → `{ snapshot: 空 Map, missing: true }`（不抛）；存在且合法 → `missing: false`。
4. 坏 YAML（语法）→ `UsersFileError`；重复键 YAML → `UsersFileError`。
5. schema 错：version 非 1、未知顶层键、未知用户字段、缺失 passwordHash、非法用户名、totpSecret
   非字符串 → 全部 `UsersFileError`。
6. 权限过宽（`writeFileSync` 后 `chmodSync(0o644)`）→ `UsersFileError`（POSIX only）。
7. write：快照 → 文件内容精确（yaml 结构、用户名字典序、`disabled: true` 显式）；mode 0600
   （`statSync` 断言，POSIX only）；`.tmp` 残留不存在；目录不存在时自动创建。

**`src/password-gate.test.ts`**（fake req headers + fake sessions（MemTable 思路复用））—

1. 白名单：`/auth`、`/auth/login`、`/auth/whatever` → allow（无凭证）。
2. cookie 通道：有效会话 → allow；未知/过期/revoked token → deny；cookie 头缺失 → deny。
3. Bearer 通道：`Authorization: Bearer <会话 token>` → allow；未知 token → deny；`bearer` 小写
   前缀可接受；带前缀格式错误 → deny。
4. `sessions: () => undefined`：cookie 与 bearer 都跳过 → deny（白名单除外）。
5. 无凭证 → deny。返回值为同步 `"allow" | "deny"`（非 Promise）。

**`src/password-endpoints.test.ts`**（fake register/limiter/loadUsers/verify/sessions；按行数拆三
文件：`password-endpoints.test.ts` 注册形状/GET login/logout/status，
`password-endpoints.login.test.ts` POST login，`password-endpoints.methods.test.ts`
405/兜底/415/413/页面 escape——矩阵合并描述）—

1. 注册形状：4 条——prefix `/auth`、exact `/auth/login`、`/auth/logout`、`/auth/status`。
2. GET login：200 + HTML 含 `<form`、`name="username"`、`name="password"`；hidden next escape
   （`next="/x?a=1&b=2"` → `&amp;`）；已有有效会话也恒 200 渲染（M20 一致）。
3. POST login 成功：fake verify true → 302 location=next + set-cookie 精确串（secure=true/false
   两态）+ `sessions().create` 被调（subject = username、ttl = sessionTtl*1000）+
   `limiter.recordSuccess` 被调 + `info("session issued")`。
4. POST login 失败：verify false → 401 `"invalid credentials"` + `info("login rejected")` +
   `recordFailure` 被调、无会话创建；未知用户（loadUsers 不含该名）→ verify 收到 **DUMMY_HASH**
   - 401；禁用用户 → verify 收到该用户真哈希 + 401（P9：三态统一）。
5. POST login 429：limiter 预置 locked → 429 + `retry-after` 数值 + `info("rate limit exceeded")`；
   **verify 未被调**（锁定期不验证）。
6. POST login 503：fake loadUsers reject → 503 `"user store unavailable"` + error 日志 + 不计
   失败；`sessions()` undefined → 503 `"session store unavailable"`。
   6b. POST login 文件缺失：fake loadUsers 返回 `{ snapshot: 空, missing: true }` → 401
   `"invalid credentials"`（空用户集）+ **首次** `warn("users file not found: ...")` 一次；
   第二次登录不再重复 warn（模块级 flag）。
7. POST login next 校验：`//evil.com` → `/`；`/ok/path` → 原样；`/auth/login`、`/auth/x` → `/`
   （M20 回环防护沿用）。
8. POST login 空 username：只动 IP 桶（fake limiter 断言 account 参数 undefined）；成功路径
   username 非空 → account 参数 = username。
9. POST logout：revoke 被调 + set-cookie 含 `Max-Age=0` + 302；next 仅 query；无 body/无
   content-type 可用；cookie 缺失也 302 幂等（M22 复刻）。
10. GET status：有效 cookie → `{"authenticated":true}`；无 → false；带 `Authorization: Bearer`
    头不影响（只认 cookie，M5）。
11. method 分发：`DELETE /auth/login` → 405 + `allow: GET, POST`；`GET /auth/logout` → 405；
    `POST /auth/status` → 405。
12. prefix 兜底：`/auth/whatever` → 404 + no-store。
13. 415/413：非 urlencoded → 415；超 16 KiB → 413 + `connection: close` + 不调 `req.destroy`
    （M19 复刻）。
14. `passwordLoginPageHtml`：直接断言 HTML 含两字段与 escape（本文件或 login-page 相关文件内）。

**`src/cli.test.ts`**（fake `CliIo`：`out/err` 收集到数组、`readLine` 返回预置行）—

1. `add` 全流程：mkdtemp 文件路径 + `--password-stdin` → exit 0、out 含 `user alice added`、
   文件已建且 mode 0600（POSIX only）、再 `loadUsersFile` 读回含 alice；用 `verifyPassword` 验证
   文件里的哈希能验证该口令（真实 scrypt 一次）。
2. `add` 失败分支：缺 `--password-stdin` → exit 1 + usage；name 非法（含空格/开头数字）→ exit 1；
   同名已存在 → exit 1 + `already exists`；stdin 空行 → exit 1。
3. `add --disabled` → 读回 `disabled: true`。
4. `list`：预置两用户（一禁用）→ 输出两行、字典序、`(disabled)` 标记；空文件 → 无输出 exit 0。
5. `disable`：→ exit 0 + `user alice disabled` + 读回 disabled；不存在 → exit 1 + `not found`；
   再次 disable → 幂等 exit 0。
6. 未知子命令/未知 flag → exit 1 + usage 到 err。
7. `--file` 指向不存在目录 → 自动创建（writeUsersFile 语义）。

**`src/index.test.ts` 适配**（既有用例全保留，新增/修改）—

1. `mode: "password"` **不再抛错**（M2 的抛错用例删除）；gate 为 `PasswordGate` 实例。
2. `mode: "token"`（默认）gate 仍为 `TokenGate`；fake ctx 记录 `get("credentials")` 被访问。
3. password 模式：fake ctx 断言 `get("credentials")` **未被访问**；端点注册走 password 版
   （fake register 记录 4 条路由，与 token 版同形）。
4. `usersFile` 默认解析：`vi.stubEnv("DSH_HOME", tmp)` 下挂载 password 模式 + `vi.mock("./password-endpoints.js")`
   捕获 `registerPasswordEndpoints` 收到的 deps → 断言 `deps.usersPath === path.join(tmp, "auth", "users.yaml")`；
   显式 `usersFile: "/x.yaml"` → `deps.usersPath === "/x.yaml"`。测试后 `vi.unstubAllEnvs()`。
5. Config 默认值：`{}` → 含 `usersFile: ""`。
6. 既有注销/自检/双缺失用例保持绿（token 分支）。

**`src/integration.password.test.ts`**（真实入口路径）— 真实 cordis + **真实 storage 栈**
（Storage → storage-json → storage-domain，挂载顺序同 `integration.auth.test.ts`）+ 真实
WebServer + 真实 users 文件（`mkdtemp` root；`beforeAll` 用 `hashPassword` + `writeUsersFile`
预置 `admin`（口令 `<test-password>`）与 `disableduser`（`disabled: true`））+ 本插件
`config { mode: "password", cookieSecure: false, usersFile: <tmp>/users.yaml }`：

1. 全流程：`GET /auth/login` → 200 含 `name="username"`；错口令 → 401；对 → 302 + set-cookie +
   location；带 cookie `GET /__probe` → 200；无 cookie → 302（HTML accept）/ 401（JSON accept）；
   `Authorization: Bearer <cookie 里的会话 token>` → 200；Bearer 错 → 401；`POST /auth/logout?next=/`
   带 cookie → 302 + Max-Age=0；原 cookie 再访问 → 401。
2. subject 审计：登录成功后 `ctx.get("auth")!.sessions!.getByToken(<cookie token>)!.subject === "admin"`。
3. 禁用/未知用户：disableduser → 401；`ghost` → 401（响应体一致 `invalid credentials`）。
4. 文件不可用：改写 users.yaml 为坏 YAML → 登录 503；恢复 → 401 正常。文件缺失（指向不存在的
   路径，独立实例）→ 登录 401（空用户集）。
5. WS 通道：带会话 cookie 的 upgrade → 101；`Authorization: Bearer <会话 token>` 的 upgrade →
   101；无凭证 → 401 拒握手（复用 M1 `requestUpgradeStatus` 模式 + 变体头）。
6. 429 限速：**独立 describe + 新 ctx/端口**（P25——不污染共享实例的 limiter）：连错 5 次 →
   第 6 次 429 + `retry-after` 头；随后正确口令也 429（锁定中）。
7. token 模式回归由既有 `integration.auth.test.ts` 承担（不动、必须绿）。

---

## 6. 实施顺序（每步保持 `npm run verify` 绿）

1. `package.json`（yaml + bin）+ `npm install --registry=https://registry.npmjs.org/`。
2. `src/password.ts` + `src/password.test.ts`。
3. `src/rate-limit.ts` + `src/rate-limit.test.ts`。
4. `src/users-file.ts` + `src/users-file.test.ts`。
5. `src/auth-common.ts`（提取 validateNext）+ `auth-endpoints.ts` 改 import——**立即跑
   `npm run test -- src/auth-endpoints.test.ts src/auth-endpoints.login.test.ts src/auth-endpoints.methods.test.ts`
   证明 M2 行为未变**。
6. `src/password-gate.ts` + `src/password-gate.test.ts`。
7. `src/login-page.ts` 增量（`passwordLoginPageHtml`，随第 8/9 步测试覆盖）。
8. `src/password-login.ts`（行数拆分件，测试经第 9 步）。
9. `src/password-endpoints.ts` + 三个测试文件（`password-endpoints.test.ts` /
   `password-endpoints.login.test.ts` / `password-endpoints.methods.test.ts`）。
10. `src/cli.ts` + `src/cli.test.ts`。
11. `src/index.ts` 装配 + `src/index.test.ts` 适配。
12. `src/integration.password.test.ts`。
13. 文档：`docs/specs/development.md` Structure 树、`README.md`（密码模式/CLI/users 文件契约）、
    `AGENTS.md`（M3 指针）。
14. `npm run build` + `lib/` 与 `src/` 同批；`git diff --exit-code -- lib` 通过。
15. 服务器端到端冒烟（DoD 4）。
16. 收尾写 `docs/handoff/handoff-m3_zh.md`（DoD 6）。

---

## 7. Definition of Done

1. `npm run verify` 全绿（format/lint/type-check/coverage ≥80%/lock:check）。
2. `npm run build` + `lib/` 与 `src/` 同批；`git diff --exit-code -- lib` 通过。
3. `npm run test -- src/integration.password.test.ts src/integration.auth.test.ts src/integration.guard.test.ts src/integration.session.test.ts` 单独跑绿（token 模式回归 + password 真实路径）。
4. **服务器端到端冒烟**（环境事实见 handoff §3；**本机 loopback 不可达，一律在服务器上验证**）：
   1. 同步：`rsync -az --exclude node_modules --exclude .git /Users/randal/source/dsh-auth/ ubuntu:/tmp/dsh-auth-test/`
      → 服务器 `cd /tmp/dsh-auth-test && npm install --registry=https://registry.npmjs.org/ && npm run build`。
   2. 建用户（真实 CLI 路径）：
      ```bash
      ssh ubuntu 'printf "%s\n" "<test-password>" | node /tmp/dsh-auth-test/lib/cli.js user add admin --password-stdin --file ~/dsh-smoke/auth/users.yaml'
      ssh ubuntu 'node /tmp/dsh-auth-test/lib/cli.js user list --file ~/dsh-smoke/auth/users.yaml'
      ssh ubuntu 'stat -c "%a" ~/dsh-smoke/auth/users.yaml'   # 期望 600
      ```
   3. overlay `~/dsh-smoke/cordis.patch.yml`：`dsh-auth` 行 config 改为
      `{ mode: "password", cookieSecure: false }`（M1 探针行确认已删——handoff §5.3）；重启实例
      （`pkill -f "[d]sh --profile web --port 3081"` 与启动**分两个 ssh 调用**，handoff §6 教训；
      `nohup ... > ~/dsh-smoke/boot.log 2>&1 < /dev/null &`，等 ~25s）。
   4. 验证序列（**先跑正确口令全流程，429 序列放最后**——30s 锁只影响登录端点）：
      - `curl -s http://127.0.0.1:3081/auth/login | grep -o 'name="username"'` → 命中；状态 200；
      - `curl -s -o /dev/null -w "%{http_code}\n" -d "username=admin&password=wrong" http://127.0.0.1:3081/auth/login` → 401；
      - `curl -s -i -d "username=admin&password=<test-password>" -c jar http://127.0.0.1:3081/auth/login | head -3` → 302 + `set-cookie`；
      - `curl -s -o /dev/null -w "%{http_code}\n" -b jar http://127.0.0.1:3081/__auth_probe` → 200；
        无 cookie：`-H "Accept: application/json"` → 401、`-H "Accept: text/html"` → 302；
      - Bearer 会话 token：`TOK=$(awk '$6=="dsh_auth" {print $7}' jar)` →
        `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOK" http://127.0.0.1:3081/__auth_probe` → 200；改错 token → 401；
      - `curl -s http://127.0.0.1:3081/auth/status -b jar` → `{"authenticated":true}`；
      - WS：无 cookie upgrade → 首行 `HTTP/1.1 401`；`-b jar` → `HTTP/1.1 101`（handoff §5.4 的
        curl 命令 + `-b jar` / `-H "Authorization: Bearer $TOK"` 变体）；
      - `curl -s -i -X POST "http://127.0.0.1:3081/auth/logout?next=/" -b jar | head -3` → 302 +
        `Max-Age=0`；原 cookie 再 `GET /__auth_probe` → 401；
      - `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/auth/whatever` → 404；
      - 最后：错口令连发 6 次（`for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" -d "username=admin&password=wrong" http://127.0.0.1:3081/auth/login; done`）
        → 前 5 次 401、第 6 次 429；`curl -s -i -d "username=admin&password=<test-password>" http://127.0.0.1:3081/auth/login | head -5` → 429 + `retry-after` 头。
   5. 收尾：杀掉实例或留用（报告状态）；`boot.log` 无 `password flow requires M3` 类报错。
5. 报告：改动文件、P1–P26 落点、覆盖率数字、与本文档的偏差（应为零）。
6. **写 `docs/handoff/handoff-m3_zh.md`**（为 M4 交接）：环境事实增量（如 scrypt 实测耗时、CLI 在服务器上的
   实际路径）、M3 冒烟真实结果、M3 踩坑清单、M4（TOTP）起点提示。已获用户指令才 commit/push。

---

## 8. 禁区清单

- **不探索 harness 内部**（同 M1/M2）；users 文件、scrypt、yaml 全部只经 §3 的事实。
- **依赖只加 `yaml`**：scrypt/CLI 参数解析/readline 全内建；devDependencies 不动；不动
  `dsh-credentials-local` 等任何 harness 包。
- **不动 token 模式行为**：`token-gate.ts`/`cookie.ts`/`form-body.ts`/`guard.ts`/`gate.ts`/
  `session-store.ts`/`self-check.ts` 零改动；`auth-endpoints.ts` 仅 P17 一处 import 机械改动；
  `integration.auth.test.ts` 必须原样绿。
- **不弱化安全参数**：scrypt N/r/p/maxmem 冻结（P1）；测试不得换弱参数（P25）；限速常量不配置化
  （P22）。
- **不落敏感值**：口令/用户名（登录日志）/哈希/会话 token 永不进日志与测试快照（P23）；DUMMY
  常量例外（非秘密）。
- **不吞认证失败**：未知用户/错口令/禁用统一 401；文件不可用 503；凭证/文件错误不静默放行。
- **不改门禁**：eslint/tsconfig/vitest/coverage 阈值不动；不加 eslint-disable（除文件内既有允许项）。
- **分支纪律**：`development`；未获指令不 commit/push；`lib/` 与 `src/` 同批。
- M4（TOTP 两段式、`revokeBySubject`、CSRF token、限速持久化）**不做**——需要时只写
  `TODO(auth-m4):` 注释（带稳定 tag）。

---

## 9. 明确不做（M3 范围外）

- TOTP 两段式登录、`totpSecret` 的使用、防重放（M4）。
- 禁用用户即时吊销已发会话（P15 局限，M4 评估 `revokeBySubject`）。
- token + password 双模式并存（mode 二选一，P11）。
- 登录限速持久化/跨进程（内存态，P10）。
- CSRF token（P21 评估结论：M3 不加，M4 再评估）。
- 登录页美化/国际化、client 半边登出按钮（GUI 组件）。
- 部署侧交付物：正式生产 `cordis.patch.yml`、部署验收清单（M3 冒烟通过后单独做，handoff §6）。
