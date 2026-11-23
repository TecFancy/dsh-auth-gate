# Agent Note: 门认证的是实例，不是门里的一个个用户

Status: implemented

[English](2026-11-15-no-user-isolation.md) | 简体中文

## Problem

加第二个账号只要一条命令（`dsh-auth user add <name>`），而两份 README 都在讲按用户建的账号和
`admin` 角色。两件事放在一起，读起来就像本插件有一个它其实没有的权限模型：每个用户有自己的会话、
自己的工作区。已有的说法只散落在 passkey-only 与登录 CSRF 两段讨论里，没有任何面向运维的局限说明
讲过这条总边界。事后才发现共享，比一开始就被告知更糟。

本插件只针对一个对手设计：实例唯一入口外的未认证者。从最初的规划开始
（[冻结的规划](../../../../docs/history/specs/dsh-auth-plan_zh.md)），多用户隔离就是被刻意去掉的。
缺的不是行为，而是把这条边界写出来的那句话。

## Decision

在运维会读的地方把这条边界写清楚，把理由记在这里。

模型本身，写准确：

- **一个有效的完整会话，拿到实例的 owner principal。** 在带路由鉴权的宿主上，一个带着有效完整
  会话、打向宿主 `required` 路由的请求，会得到 `{ principal: { kind: "owner" } }` peer
  （[`src/host-auth-wiring.ts`](../../../../src/host-auth-wiring.ts)）。所有这类会话共用一个 peer；
  宿主把它 abort 之后换上的新 peer 仍然是 owner。bootstrap 与 `password-change-only` 会话得到
  `undefined`，宿主保持它的 `401`；插件自己的 `/auth/*` 路由是 `anonymous`，不走这个 peer。
- **插件不在这之上再加一层按用户的隔离。** `PasswordGate.decide()`（password 模式）放行任何
  「非 bootstrap、非受限」的会话；它从不读 `users.yaml`，也从不在 `subject` 或 `role` 上分支
  （[`password-gate.ts`](../../../../src/host/features/password/model/password-gate.ts)）。
  会话类别的围栏存在，是因为这类会话能做什么，不是因为它是谁的。peer 粒度之所以是 owner，是因为
  宿主的权限问题只问「放行还是不放行」，而插件对每个完整会话都同样回答。
- **`subject` 不是数据归属键。** 它标记的是产生该会话的那份凭证。它用于审计、吊销，以及取回调用者本人的
  记录；没有任何准入判断用它给两个用户不同的 principal。
- **`role: "admin"` 不是宿主数据的隔离边界。** 它的服务端授权检查恰好只有 `GET /auth/users`、
  `POST /auth/users/password` 与 `GET`/`POST /auth/passkey/settings`。其余位置上的角色是标签
  （`/auth/status`、账号头部）、纯客户端的渲染门（用户管理块，以及页脚里与 token 模式并列的点星
  入口）、一条 CLI 变更（`dsh-auth user role`），或一条写入不变量（最后一个活跃 admin 不能被移除）。

对运维来说，这就意味着冻结规划里写的那种共享：规划说，任何过了门的 client 都能看到并打开所有会话。
这句话里属于本插件的那一半是它自己控制的部分：给每个完整会话同一个 owner principal，并且没有
自己的按用户的一步；宿主向 owner peer 交出什么，是宿主的决定，不是本插件的。

三处披露各自承担一层：两份 README 的「它不做什么」（对运维说的事实）、
[`known-limitations`](../../../../docs/deployed/known-limitations_zh.md)（机制），以及
[`security` 第 16 节](../../../../docs/security_zh.md)（一项刻意的非目标，挨着本来就依赖它的
CSRF 省略）。

## Alternatives considered

- **在本插件里实现按用户隔离。** 拒绝：那是另一个产品，而且大部分得建在本仓库之外。要让宿主面上
  的用户彼此区分，就得给每个会话记归属、给每个带标识的请求校验归属、并在流式面上重复同样的校验，
  而部分实现的泄漏恰恰发生在最不容易看见的地方。它还会把一道登录门变成多租户平台。
- **只过滤会话列表。** 拒绝：面板里不再显示别人的会话，而其余面照旧交出去。虚假的隐私感比
  写明的「不隔离」更糟。
- **什么都不说。** 拒绝：按用户的账号加上 `admin` 角色读起来就是权限模型，沉默不是中立，是
  用省略误导。

## Consequences

- 运维可以在部署前做选择：保留单门模型，或另装一个实现了按用户隔离的插件。
- 端点、载荷、配置键都没变，版本下限也没有移动。这次只是把边界写下来，不是新行为。
- 登录、重置口令、吊销仍然按用户进行，用户列表仍然只有 admin 能看。缺少的是「一个已登录用户的
  数据对另一个已登录用户保密」在宿主面上的落实。
- 这条声明只在准入模型不变时成立。将来如果引入按会话的 principal，这篇笔记、两份 README 和
  两页文档必须一起改。
