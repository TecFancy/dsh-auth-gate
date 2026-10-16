# `/auth/*` 路径收进一个跨半边契约 `src/protocol/`

## 决定了什么

本插件的路由路径（`/auth`、`/auth/login`、`/auth/logout`、`/auth/status`、`/auth/password`、
`/auth/users`、`/auth/users/password`）、登录页原因键 `password-changed`，以及由它们拼出的几个 URL
（`loginPath()`、改密后跳转、登出提交目标）和前缀判定 `isAuthPath()`，只在 `src/protocol/index.ts`
定义一次。这个文件只放纯常量与纯函数，不 import 任何东西。

两个半边各经一个桥进来：host 走 `src/host/shared/protocol/index.ts`，client 走
`src/client/shared/api/protocol.ts`。其余文件一律经本半边的桥拿路径，不直接引 `src/protocol/`，
也不再写路径字面量。`slice:check` 强制三件事：`src/protocol/` 不引用自身以外的文件；只有这两个桥可以
引用它；引用必须落在 `src/protocol/index.ts`。

`src/protocol/index.test.ts` 钉住每个值。改路径就是改对外契约，要先改那里的期望值。

## 背景

改动前，同一组路径在源码里写了二十多处：host 侧 `guard.ts` 与 `password-change.ssr.ts` 各定义了一份
`LOGIN_PATH`，两个 endpoints 文件各自写注册路径，`auth-common.ts`、两个 gate 各写一遍 `/auth` 前缀判定；
client 侧五个文件各写一份请求目标。

client 与 host 两个半边按 D30 互不 import，所以跨半边的一致性只能靠
`integration.p11-pins.test.ts` 按源码文本比对，而且只覆盖了改密后跳转这一条。其余路径一旦有一侧改了，
就要等到运行时才会发现。

## 考虑过的替代方案

- **放进 `src/host/shared/protocol.ts`**：`host/shared` 是 host 半边的层，它的段 barrel 会带出 Node
  代码。client 要用就得开「绕过 barrel 直引单文件」的例外，一旦有人误引 barrel，Node 代码就会被打进
  浏览器 bundle。
- **继续用源码文本钉子**：把 p11 的做法推广到每条路径。钉子只能发现不一致，不能消除重复，而且每加一条
  路径就要多写一条钉子。
- **两半边直接引 `src/protocol/index.ts`，不设桥**：Steiger 会看到大量越出被分析树的深层相对 import，
  client 文件还要写 `../../../../protocol/index.ts` 这样的路径。设桥后，FSD 视角里它只是一个普通的
  `shared` 段。
- **在契约里再放一张路由表（kind + path）**：password 模式按接线有无决定注册哪些路由，一张静态表要么
  重复这些条件，要么与实际注册不符。注册集合的校验交给 `host:check` 从源码读取。

## 为什么这样选

把路径定义成一份，是直接消除漂移的来源，而不是事后去检测它。契约文件不 import 任何东西，所以两个
构建（Node 的 host、浏览器的 client）都能安全地包含它，而 client bundle 多出来的只是几个字符串。
用两个桥收口，D30 的分层检查完全不受影响，新规则也只需在 `slice:check` 里加几行。
