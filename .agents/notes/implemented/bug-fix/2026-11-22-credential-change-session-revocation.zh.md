# Agent Note: 凭证变更会撤销会话，CLI 路径也不例外

Status: implemented
Legacy ID: D40

[English](2026-11-22-credential-change-session-revocation.md) | 中文

## Problem

`docs/security.md` §6 承诺凭证变更会撤销该用户的全部会话，Web 路径也确实兑现：设置面板的自助改密和
管理员重置都会立即撤销。CLI 路径没有。`dsh-auth user passwd` 在独立进程里重写存储的哈希，够不到运行
中插件的会话存储，于是被盗的 cookie 与 Bearer token 会一直有效到 TTL 到期——在怀疑账号被入侵之后
由运维执行的那次重置，恰恰是唯一一条把攻击者的会话留在原处的路径。旁边还有两个小缺口：从
`users.yaml` 删除的用户仍保留会话，而 `dsh-auth user add` 跳过了 Web 写入路径执行的口令策略。

## Decision

`users.yaml` 增加一个可选的每用户字段 `password_changed_at`（ISO-8601）。三条口令写入路径都通过同一个
helper（`src/host/entities/user/model/password-change-mark.ts` 里的 `applyPasswordChange`）盖这个
时间戳：CLI `user passwd`、自助改密、管理员重置。插件的 `DisabledSessionSweeper` 在每轮 password 模式
的扫描里处理三种情况，比较的是绝对凭证版本（不记上次值），所以插件停机期间发生的变更也能在下次启动后的第一轮被清掉：

- 被禁用的用户，全部会话都被撤销；
- 有 `password_changed_at` 的用户，凭证版本更旧的会话被撤销（会话记录签发时读到的版本，所以
  「校验跨越改密」也造不出幸存者）；变更之后用新口令登录签发的会话保留，这让扫描是幂等的；
- 已不在 `users.yaml` 里的 subject，全部会话都被撤销。bootstrap 会话不会被会话存储枚举，内部
  `token` subject 按名字豁免。

Web 路径仍然立即撤销；扫描是 CLI 路径和重启之后的兜底。间隔仍是 `revokeSweepMs`（默认 5 秒），
`0` 保留既有的关闭选项：没有定时器，CLI 路径就退回等 TTL 到期。CLI 在 `user passwd` 成功后会把这段
延迟打出来。`dsh-auth user add` 现在和 Web 写入一样跑 `checkPasswordPolicy`，所以 CLI 造不出弱口令
初始账号。

## Alternatives considered

- **让 CLI 直接持有会话域。** 拒绝：CLI 是独立进程，会话存储属于运行中的插件（进程内、按实例持久化）；
  让第二个进程写它意味着一个文件有两个写者，还要为它发明一套锁协议。
- **在每次请求的门里重新检查口令变更时间戳。** 拒绝：门被冻结为同步、零文件 IO 的决定；在那里读
  `users.yaml` 等于把磁盘 IO 放进每个请求的受理路径。
- **把 `docs/security.md` §6 收窄到 Web 路径，并在 CLI 里大声警告。** 拒绝：入侵之后由运维执行的
  重置正是绝不能留下存活会话的路径，把这个缺口写进文档比补上它更糟。
- **存一个每会话的撤销标记，而不是比较时间戳。** 拒绝：变更之后签发的会话就是全部判据，而每次改密
  都重写会话行只是为同一个保证增加更多活动部件。

## Consequences

CLI 重置现在会吊销会话，但不是同步的：窗口是一轮扫描间隔（`revokeSweepMs`，默认 5 秒），插件停机时
会拉长到下次启动，而运维配置了 `0` 时则不存在（CLI 读不到那个配置，所以它的提示无条件写明这段
延迟）。时间戳是对 `users.yaml` schema 的新增：旧文件按可选字段原样加载，而本版本写出的文件带着旧版本
严格 schema 会拒绝的键，所以第一次改密之后不要降级插件。被删除的用户走同一条孤儿扫描，这也意味着在
`users.yaml` 里改名会把旧 subject 登出。bootstrap 类别与 `token` subject 不在扫描范围内，因为两者都
不是 `users.yaml` 用户。Web 路径上面向用户的行为不变；
[自助改密笔记](../feature/2026-09-23-self-service-password-change.zh.md)仍然拥有那条流程。
