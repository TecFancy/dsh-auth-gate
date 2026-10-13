# D11. 认证 HTTP 端点公共件独立成 http 层

## 决定了什么

token 与 password 两个认证面重复的端点件（`authCatchAll`、`logout`、
`status`、`queryOf`、`methodNotAllowed`）抽进新的核心机制层 `src/http/`
（与 `gate/`、`session/` 并列），两个 feature slice 经 `http/index.ts`
barrel 引用。`src/shared/` 保持叶子层，约束一字未改。

## 背景

2026-08-30 的分层重构（D5）把 `gate`/`session` 立为核心机制层，但两个认证面
各自留了一份退出/状态/兜底/Method 守卫逻辑，其中 `logout` 函数体逐字节相同。
去重只有三个可能落点：`shared`、`session`、或新立一层。

## 考虑过的替代方案

- **`src/shared/http-auth.ts`** —— D5 与 `verify-slice-boundaries.mjs` 把
  `shared` 定义为不向上依赖的叶子层，而 logout/status 需要 `session` 的
  `buildSetCookie` 与 `SessionStore`；这要么破坏叶子约束，要么把 cookie
  构造当参数注入，两种都比新立一层更绕。
- **塞进 `src/session/`** —— `methodNotAllowed`、`authCatchAll`、`queryOf`
  与会话无关，放进去会让会话层变成杂物间。
- **保持重复** —— 两处已经逐字节同构，任何一处改行为（M22 的 logout 语义
  就是一例）都得记得同步另一边。

## 为什么这样选

`http/` 与 `gate`、`session` 同属「跨模式核心机制」。依赖方向
`http -> session/shared` 单向清晰，`features/* -> http` 依旧只走 barrel，
`shared` 的叶子约束原封不动；`slice:check` 只需把新层加进白名单即可守护它。
