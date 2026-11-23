# Agent Note: 账号页脚显示 host 版本号，并向运营者要一颗星

Status: implemented

[English](2026-11-23-version-footer-and-star-ask.md) | 简体中文

## Problem

部署方无法知道自己跑的是哪一版。唯一的答案是在正确的 profile 里 `npm ls`，或者翻
`package.json`；而设置面板 - 每个已登录用户都会打开的那一面 - 什么都没说。这里这个缺口很贵，
因为行为是按版本分叉的：dsh `0.2.3-alpha.2` 及以后，首次配置向导无法校验 launch token，
[known-limitations](../../../../docs/deployed/known-limitations_zh.md) 也是按版本边界写的。
「你装的是哪个版本」是每个报障的第一句话，而没有任何便宜的办法回答它。

另一半是：从来没有人被邀请给仓库点星。月下载约 6k，仓库 21 颗星。这是分发的事实，而不是
「到处都放一句邀请」的理由 - 真正的问题是：哪一面是运营者的，哪一面是别人的。

## Decision

在「账号安全」分区最下面加一行页脚：

- 每个已登录用户都能看到 `dsh-auth-gate v0.24.0`，取自运行中的 host 进程；
- 同一行里的 `给个星星鼓励一下 ★` / `Give it a star ★` 只给运营者看：`mode: "token"`
  （共享 token 是默认模式 - 能走到这一页的人就持有那枚 token）或 password 模式下的 `role === "admin"`。

这一行里有三个决定。

**版本号来自 host，不来自前端 bundle。** `GET /auth/status` 增加可选的 `version`，由
`session-endpoints.writeStatus` 从 `SELF_VERSION`
（[shared/lib/version.ts](../../../../src/host/shared/lib/version.ts)）写出 - 加载时同步读一次
`package.json`，读不到就是 `""`。前端 bundle 是显而易见的替代方案，而它是错的：插件升级之后，
浏览器可能还在跑缓存的旧 bundle，页脚恰恰是全产品里唯一会因此报出一个已经不在机器上的版本号的
地方。同一个响应还带上了 `mode`，没有它这条受众规则根本无法表达。

**邀请的对象是运营者。** 「账号安全」页每个已登录用户都能打开；password 模式下这些人是部署方的
同事，不是本项目的受众。登录页出于同一个理由早已守住这条边界 - 把第三方链接放在别人的认证面上，
往好里说也是让人困惑 - 而把它往里挪一页，并不改变「这是谁的地盘」。token 模式按构造就是例外：
那里没有角色，能打开这个页面的只有装插件的人。

**未知不反推。** host 不知道的两个键整键缺席，client 半边解析器留成 `undefined`，页脚因此只渲染一行
而不是两行。它不会把「缺 `mode`」当成 `"token"`，也不会渲染一个空的 `v`。这与 `/auth/status`
其余字段的加法兼容规则一致：缺席表示「不知道」，永远不是默认值。

## Alternatives considered

- **前端构建时的版本常量。** 拒绝：它报的是缓存 bundle 的版本而不是正在跑的版本，正是这个页脚要
  防的那个谎。
- **向每个已登录用户展示邀请。** 拒绝：那是把维护者的仓库推销给部署方的同事，和放在登录页是同一个
  错误，只是往里挪了一页。
- **通过遥测端点统计星标点击。** 拒绝：契约 v1 的键集固定，而且星标不是使用数据。GitHub 自己的
  referrer 流量就能回答这个问题，不需要新字段。
- **`postinstall` 打印横幅，或安装时打开浏览器。** 拒绝：一个在安装期执行代码或打印广告的认证包
  是供应链味道，而这个仓库精确记录自己的网络行为，就是为了不是那种东西。
- **在同一次改动里做检查更新。** 推后，见下。

## Consequences

- `/auth/status` 增加两个可选键。旧 client 忽略它们；旧 host 不写它们，页脚因此少渲染几行。
  没有抬高任何版本下限。
- 版本号按构造就是对的：release-please 改 `package.json`，host 读它，集成测试断言的是同一个文件
  而不是字面量，所以发版不会把 CI 弄红。
- 邀请只到达运营者，代价是一行、不阻塞任何动作、不存任何东西，单次页面渲染内不重复。
- README 里那张面板截图（`docs/demo/account-change-password.en.png`）不含页脚。不会为一行 12px
  的文字重拍截图；那张图是插图，不是规格。
- 旧 host 上的 token 模式实例看不到星标：`mode` 缺席，而缺席不反推。

## Deferred

- **检查更新。** 形状已经定了：host 侧、缓存至少一天、失败完全静默、只在有新版本时多出一行、
  不要「已是最新」徽标、不做自更新 - 安装是 dsh 插件管理器的事，而一个安全插件在运行中改写自己的
  `lib/` 是未定义状态。它需要在 README 的「匿名使用统计」一节和 `docs/security.md` 里补一条新的
  对外请求，所以拆成独立改动。
- **将来撤掉版本行。** dsh 的插件市场已经知道已发布版本，将来可能自己显示「已安装 / 可升级」。
  真到那天，这个页脚保留版本行，别的都不删。

## Verification

- `session-endpoints.facts.test.ts` - 已知时两键都写、未知时两键都缺席、空版本号从不写出、
  身份投影不变。
- `account-status.test.ts` - `mode` 与 `version` 的白名单解析，含 `""` 与非字符串。
- `section-footer.test.tsx` - 两种语言的版本插值、空版本号视为未知、链接的 target 与 `rel`、
  受众门。
- `account-section.footer.test.tsx` - 经真实分区接线的门：普通用户只看得到版本号，管理员与
  token 模式看得到星标，旧 host 不渲染页脚。
- `integration.auth.test.ts`、`integration.revoke.test.ts` - 逐字节钉住线上字符串，版本号取自
  `package.json`。
