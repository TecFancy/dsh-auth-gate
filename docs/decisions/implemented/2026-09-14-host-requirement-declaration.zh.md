# D12. 宿主要求声明与 storage-domain 转 peer

## 决定了什么

两件事一起做：`package.json` 顶层新增 `engines.dsh`，声明宿主走廊
`^0.1.0-rc.6 || ^0.1.5-rc.2`；`@deepseek-ai/dsh-storage-domain` 从
`dependencies` 移到 `peerDependencies`（同一串范围），并在 `devDependencies`
保留 `^0.1.0-rc.6` 供本仓构建与测试。插件运行时不再自带该包的副本。

## 背景

商店（dshmarket）的「宿主要求」徽标只读三处：顶层 `engines.dsh`、
`dsh.engines.dsh`、以及宿主清单内的 `@deepseek-ai/dsh-*` peer 声明。本插件
此前三者皆无，徽标显示「未声明宿主要求」。

比徽标更实际的问题在依赖字段：`@deepseek-ai/dsh-storage-domain` 是宿主共享包
（`@deepseek-ai/dsh-base` 依赖它），写成普通依赖后 pnpm 在插件内部装了一份
嵌套副本 `0.1.0-rc.8`，与宿主树里的 `0.1.5-rc.2` 并存——同一进程两份 domain
契约，且这份副本不会跟着宿主升级。根因是 semver 的预发布规则：
`^0.1.0-rc.6` 在严格语义下永远匹配不到 `0.1.5-rc.2`（只有预发布元组相同的
比较器才放行），而市场的发现路径恰好开了 `includePrerelease`——于是出现
「市场看着兼容、pnpm 却装旧线副本」的割裂。

官方口径（dsh main 决策笔记 `2026-09-10-public-package-manifest`）：宿主要求
放**顶层** `engines.dsh`；peer 不足以单独标识「当前运行的 dsh 进程」，且安装器
与加载器都不强制该声明。

## 考虑过的替代方案

- **只加 `engines.dsh`，storage-domain 留在 `dependencies`** —— 徽标有了，但嵌套
  旧线副本原样留存：两份 domain 契约继续并存，宿主升级时这份副本纹丝不动。
- **peer 范围只写已验证线 `^0.1.5-rc.2`** —— 0.1.2-alpha / 0.1.5-rc.1 的宿主会被
  判「低于下限」而报警；而插件的 `webServer` 服务契约与 storage-domain API
  （导出集合与 0.1.0-rc.8 逐一相同）在那条线上并未变化，属于假警报。
- **peer 范围写成单段 `^0.1.0-rc.6`** —— 严格语义下匹配不到当前宿主
  `0.1.5-rc.2`，市场 profile 摘要会打出 "peer range … does not match resolved …"
  的假警告。
- **把声明放 `dsh.engines.dsh` 而非顶层** —— 顶层是官方位置，且两者同时存在时
  市场只认顶层，多写一处只增加漂移面。

## 为什么这样选

`^0.1.0-rc.6 || ^0.1.5-rc.2` 的 `||` 形式让两条走廊在**严格** semver 下都成立
（`0.1.0-rc.x` 命中第一段、`0.1.5-rc.x` 命中第二段）：既覆盖本仓 dev 走廊
（当前解析 `0.1.0-rc.8`），又覆盖生产宿主 `0.1.5-rc.2`，写法也与
dsh-plugin-subscriptions 的 `^0.1.1-rc.2 || ^0.1.2-alpha.1` 一致。engines 与
peer 用同一串，市场 `displayRequirement` 去重后徽标只显示一条。把
storage-domain 交给宿主后，pnpm 不再为插件装第二份，插件跟着宿主一起升级；
它是 dsh-base 的依赖，装 dsh 就在，不存在缺件。
