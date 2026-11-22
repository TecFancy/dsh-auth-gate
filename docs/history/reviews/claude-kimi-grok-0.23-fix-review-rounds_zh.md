# Claude、Kimi 与 Grok 评审轮次 — 0.23 评审整改

- **日期**: 2026-11-22
- **审阅者**: Claude Code（`claude-agent-sdk`）、Kimi K3.1 Pro（`kimi-coding/k3.1-pro`，经 `litellm`）与 Grok 4.7（xAI），各自是独立的只读 agent，不执行测试
- **范围**: 分支 `fix/0.23-review-followups` 对 `origin/development`；基线 `846057c`，修复提交 `049e221`、`5d14698`、`92e0567`、`a6ec5ca`
- **结果**: 每一轮都是 request-changes；每一条阻塞项都已修复；最后一次增量复核确认了最后三个 P1 的关闭，剩下的那个 P0 是主导会话自己改坏的导入，在推分支之前已修复
- **配套文档**: [四路 agent 评审](claude-code-0.23-full-repo-review.md)，也就是这些轮次所复核的发现来源

## 这份记录是什么

它记录归档的四路评审之后进行的外部评审轮次：每轮的结论，以及每一条阻塞发现的处理方式，好让后来的读者分清哪些结论被谁、在哪个提交里核实过。它不是权威：提交与代码才是。

## 方法

每一轮里，审阅者拿到基线提交、一份 diff 与上一轮的发现，被要求给出结论以及带 `file:line` 的 P0/P1/P2 发现。审阅者只静态读代码；没有人跑门槛套件、测试、类型检查或构建（跑的是主导会话）。发现都在下列提交里修复，下一轮只复核增量。

## 第一轮 — 三位审阅者针对 `049e221`

| 审阅者 | 结论 | 阻塞发现 |
| --- | --- | --- |
| Claude | request-changes | 受理闸门用 `failures + inflight`，锁到期后仍被挡到衰减窗口，文档承诺的退避在登录路径上从不发生 |
| Kimi | request-changes | 同一个 P1；另外，跨过改密时刻才签发的会话因为吊销比较的是 `createdAt` 而永不失效 |
| Grok | request-changes | 同一个受理 P1；附带指出二次 wrap 的所有权与 `<` 对 `<=` 的吊销边界 |

三位共同提到的非阻塞项：`password-change` 与管理重置仍是 check-then-record；`mountRoutes` 的卸载在第一个抛错的 disposer 处停住；verify 与 publish 各自解析 ref；未知 401 仍被读成「口令错」；列表刷新失败会抹掉成功播报；CLI 提示忽略 `revokeSweepMs: 0`；时间戳在同一毫秒内不唯一；passkey 的账号桶没有在受理时生效；`token` 与合法用户名冲突；格式错误的 200 状态体会塌缩成「未登录」；限速器会淘汰仍在锁定的桶；ceremony 存储按插入序淘汰；users.yaml 锁的 compare-then-rm 仍有竞态。

## 处理 1 — `5d14698`

- 限速器只按在途占位受理；到期由 `lockUntil` 表达，strikes 跨到期保留，衰减与淘汰都不碰仍在锁定的桶。
- 会话记录登录时读到的凭证版本，扫描器按版本吊销而不是比较签发时间；`revokeBySubjectBefore` 删除。
- `password-change` 与管理重置改为受理 + 结算；管理面的失败结算放在审计上下文之外的 `WeakMap` 里，事件形状不变。
- 第二次 `wrapServer` 返回空 disposer；路由卸载先摘完全部条目再抛第一个错误；发布链路 verify 与 publish 共用一个解析出的 SHA。
- 客户端：未知或无 body 的 401 进入会话失效视图，刷新失败保留最后一份可用列表并挂提示，格式错误的 200 状态体算探针失败。

## 第二轮 — 三位审阅者针对 `5d14698`

| 审阅者 | 结论 | 阻塞发现 |
| --- | --- | --- |
| Claude | request-changes | `resolve` 把裸 commit SHA 喂给 `git ls-remote`（自动发布路径会失败）；向导签发的会话没带凭证版本，会被扫描器吊销；passkey 的账号占位在并发计数器分支与验证抛错时泄漏 |
| Kimi | request-changes | passkey 占位泄漏与单次失败双计；同一个发布解析失败 |
| Grok | request-changes | 同样这两条 P1（发布解析、passkey 占位） |

非阻塞项：`combineAdmissions` 把后到的用户名传给主句柄，造成账号失败双计；`admitAccount` 的结算不幂等；锁到期后最多放进了 5 条探测；版本在同一毫秒内可能相撞；未来时间戳被忽略而不是参与比较；孤儿扫描把 `token` 排除在外；空的 passkey 列表隐藏刷新失败；管理成功没有清自己域的 IP 桶；若干注释仍在描述旧的 `createdAt` 规则。

## 处理 2 — `92e0567`

- 发布解析：自动路径直接用 `GITHUB_SHA`，tag 先取 peel 后的提交，手工重发只接受已存在的 tag（dispatch 不能发布未合入的提交）。
- `createAdmin` 返回它写下的版本，setup 端点把它交给签发路径，向导会话因此能活过首轮扫描；接线层新增一条测试覆盖这次传递。
- passkey 通过合并句柄在每条出口结算（含验证抛错）；账号结算幂等；合并句柄不再双计；锁到期后只放 1 条探测。
- 凭证版本按用户严格单调；未来时间戳照常参与比较；孤儿扫描不再豁免 `token`。
- 管理成功清自己域的 IP 桶；空的 passkey 列表也会显示刷新失败。

## 第三轮 — Claude 针对 `92e0567`

三个 P1 确认关闭。发现一个 P0，是主导会话自己改出来的：`bootstrap-wiring.ts` 的 feature 导入被改成了 `import type`，根本无法编译，构建与 `tsc` 门槛都会失败。另有一条 P2：手工 dispatch 仍可指定裸 SHA 或分支。

## 处理 3 — `a6ec5ca`

恢复值导入；手工重发只接受 tag；向导会话的版本传递补上了接线层测试。这个提交上 `npm run verify` 绿色通过。

## 最终状态

- `a6ec5ca` 上 `npm run verify`：exit 0，22 个 gate 加 12 个门自测，包含全量 vitest、两个 TypeScript 工程、构建以及已提交 `lib/` 的一致性检查。
- 明确延后：`zh-prose` 基线棘轮（S1）；ceremony 存储的淘汰顺序与 IPv6 /64 归并（L10 边角）；users.yaml 锁的 compare-then-rm 窗口；TOTP 挑战 cookie 不带凭证版本；历史遗留的 `bootstrap`、`token` 用户名仍可维护。
- 三位审阅者都是只读且没有运行任何东西；并发、CI/OIDC 执行与真实宿主 socket 行为属于推理结论，不是观测结论。
