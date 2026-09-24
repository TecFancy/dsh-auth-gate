# dsh-auth M2 管理面（D25，2026-09-24）

本文件是 P2 管理面（D25，2026-09-24：管理员重置口令与强制改密登录门）的 executable spec
切片。以下内容从 [impl-m2_zh.md](./impl-m2_zh.md) **原样搬出**；impl-m2_zh.md 保留 M2
基线契约，并在每个原位置留下指针。D25 的完整理由见
[D25 记录](../decisions/implemented/2026-09-24-admin-password-reset.zh.md)。

## 4.5b 路由与端点修订（D25，2026-09-24）

**D25 修订（2026-09-24）**：password 模式到 1 prefix + **6 exact**（新增 `/auth/users`
（`allow: GET`）与 `/auth/users/password`（`allow: POST`））；`/auth/password` 也响应 `GET`，
返回服务端渲染、无 JavaScript 的改密表单（未认证的 `GET` 为
`302 /auth/login?next=/auth/password`），其 `allow` 变为 `GET, POST`，P1 的 `POST` 被取代。
token 模式仍只注册 3 exact，**从不**注册管理路由。已认证的 `/auth/status` 走加法字段
（`name`、`role`、`disabled`、`totpEnabled`、`mustChangePassword`、`sessionKind`）；未认证、
subject 已不在 yaml、yaml 读取失败三种情况都只回原有两键且**键集合相等**。

**实现期复审修订（2026-09-24，评审后收紧）**：三处收紧，不改路由模型与拒绝顺序。
（1）`validateNext` 与 `denyHttp` 的 302 共用同一个判定（`shared/auth-common.ts`），同时拒绝
C0 控制符与 DEL：浏览器在解析 URL 前会剥掉 ASCII TAB/LF/CR，`"/\t/evil.com"` 否则会变成协议
相对的 `//evil.com`；CR/LF/NUL 又会让 `writeHead` 抛 `ERR_INVALID_CHAR`（宿主 webserver 回
`400` 而不是预期的 `302`）；logout 的重定向消费同一判定。（2）管理重置的锁内 RMW 会先按
**锁内快照**复核 actor 仍是 admin 且未禁用，若授权读之后被降权/禁用则回 `403` + 审计
`forbidden`，不写哈希、不吊销、不计失败。（3）审计 `target` 先剥 C0/DEL 再截 64 字符（业务
字段保持原值），无会话的拒绝仍记 `info` 级。

### 4.5b.1 `/auth/status` 加法字段

**D25（2026-09-24）**：已认证时追加 `name`、`role`、`disabled`、`totpEnabled`、
`mustChangePassword`、`sessionKind`；未认证、subject 已不在 yaml、yaml 读取失败三种情况都只回
原有两键（键集合相等，绝不出现 `role: null` 占位）。

## 5b 测试矩阵增量（D25，2026-09-24）

1. **D25（2026-09-24）**：password 模式注册 7 条（1 prefix + 6 exact）；快照断言六条路径**及各自 `allow` 值**（`/auth/password` = `GET, POST`、`/auth/users` = `GET`、`/auth/users/password` = `POST`），并断言 token 模式仍恰好 3 条 exact、管理路径一条都不在。
