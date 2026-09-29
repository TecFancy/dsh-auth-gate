# D26. 宿主走廊扩到 0.2.x：`engines.dsh` 与 storage-domain peer 同时声明 `^0.2.0-rc.1`

## 决定了什么

声明的宿主走廊增加一个替代项——顶层 `engines.dsh` **与**
`@deepseek-ai/dsh-storage-domain` peer 同时变为
`^0.1.0-rc.6 || ^0.1.5-rc.2 || ^0.1.7-alpha.1 || ^0.2.0-rc.1`——并把 dev/测试宿主
cohort（`dsh-host-webserver`、`dsh-storage`、`dsh-storage-domain`、`dsh-storage-json`）
上移到 `^0.2.0-rc.1`（实际解析到 `0.2.0-rc.2`）。**不改源码**：本插件用到的接缝
（`webServer` 路由表、storage 域、客户端槽位）在两条线上行为一致。

## 背景

dsh `0.2.0-rc.2`（2026-09-29 发布，npm `next`）在 `dsh-app-boot` 里新增了
**插件兼容闸门**（`evaluatePluginCompatibility`）。它只评估名字为
`@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头的 `peerDependencies` 条目，判定用
`semver.satisfies(runtime, range, { includePrerelease: true })`；顶层 `engines.dsh`
**不参与**判定。因此不声明 0.2.x 会有两个后果，第二个才是危险的：

- `dsh plugin add` 直接拒绝安装
  （`Plugin dsh-auth-gate@0.15.0 is incompatible with dsh 0.2.0-rc.2: peerDependencies {...}`）；
- 启动时**不兼容的 bundle 整层被跳过**，只在 stderr 打一行
  （`dsh: skipping profile bundle "dsh-auth-gate": ...`），实例照常对外服务——登录门
  **静默消失**而不是响亮失败。门消失是 fail-open 回归，不是「少个功能」。

闸门拿**正在运行的** `dsh-app-boot` 版本去比对每条 `@deepseek-ai/dsh*` peer 范围，所以一条
`@deepseek-ai/dsh-storage-domain` peer 实际上就是「本插件接受哪些宿主版本」的声明。这也正是
走廊串必须与 `engines.dsh` 逐字相同（D12）、以及「只加宽 `engines.dsh`」永远过不了闸的原因。

扩走廊之前收集的证据（2026-09-29，隔离 dsh `0.2.0-rc.2`，生产全程未动）：

- 本仓库自己的测试套件跑在 `0.2.0-rc.2` 宿主 cohort 上：111 个文件 / 968 例全过，
  其中包含真实挂载 `@deepseek-ai/dsh-host-webserver` `webServer` 的集成测试；
- **npm 上已发布**的 `0.15.0` 在精确版本豁免下跑在 `0.2.0-rc.2` 上：登录门（`302` 到
  `/auth/login`、API `401`）、密码登录、TOTP 两段式挑战、改密并吊销会话、设置面板
  「Account security」分区、launch-token 桥、客户端 bundle 正常投递、console 零错误——
  证明**已发布的插件代码**不需要改动；
- **本分支的工作区构建**（版本串仍是 `0.15.0`，且已带上未发布的 P2 改动）在 `0.2.0-rc.2` 上
  **不带任何豁免**安装：启动日志没有 `skipping profile bundle`，同一套门断言通过，
  真实入口覆盖 67/67——记录见 `docs/deployed/entry-coverage-0.2.0-rc.2_zh.md`。只有这份构建
  带上了加宽后的 peer，所以只有它能证明「元数据改动足以过闸」；上面那次豁免运行证明的是
  「代码本身不用改」；
- `@deepseek-ai/dsh-storage-domain` 的导出声明集合在 `0.1.7-rc.2` 与 `0.2.0-rc.2`
  之间逐行一致（对打包产物的 `lib/**/*.d.ts` 导出做 diff）。

随 dev cohort 上移一并接受的取舍：CI 现在只用 `0.2.0-rc.2` 宿主包跑测试套件，只在 `0.1.x`
宿主包上出现的回归不再被 CI 拦住。`0.1.x` 线仍由声明支持，生产也会一直留在它上面，直到带这条
走廊的插件版本发出去。

## 考虑过的替代方案

- **只改 `engines.dsh`**——闸门根本不读它，安装照样被拒、bundle 照样被跳过，对真正的
  阻断零效果。
- **只改 peer，`engines.dsh` 留在 0.1.x**——闸门放行，但市场徽章（D12）和 npm 自己的
  engine 检查读到的仍是旧走廊，两处声明从此有漂移空间。
- **只声明 `^0.2.0-rc.1`（丢掉 0.1.x）**——生产今天跑 `0.1.7-rc.2`；丢掉它等于把正在
  运行的宿主标成不支持，并关上回滚路径。
- **dev cohort 留在 0.1.x**——集成测试将继续对着不再是首要目标的宿主线跑，而 0.2.0 的
  闸门恰恰是需要覆盖的那类宿主面变更。
- **等 `0.2.0` 稳定版**——闸门已经在用户从 `next` 装的 rc 线上生效；"等"等于明知会
  静默失守还发出去。
- **dev 宿主包精确钉 `0.2.0-rc.2`**——本仓库既有风格是走廊下界的 caret，锁文件本来就钉住
  了实际解析结果，精确钉只是每个 rc 多一次改动。

## 为什么这样选

闸门读的是 peer，所以 peer 串才是起作用的声明；让 `engines.dsh` 与它逐字相同，既保住
D12 的单一徽章属性，也让两者不可能漂移。用**追加**替代项而不是替换范围，可以同时声明
两个宿主：生产 `0.1.7-rc.2`（含回滚）与 npm `next` 安装的 `0.2.x` 线。把 dev cohort 上移
到新线，让 968 例测试套件（含集成测试）跑在插件正在为之做准备的宿主上；真实入口覆盖探测
则补上单元测试看不到的一层：0.2.0 路由表暴露的每个**受守卫**入口，在未认证时依然被拒。

本决定附带三条**发版约束**，对发这个版本的人具有约束力：

1. **隔离证据描述的是工作区构建，不是已发布包。** 版本号由 release-please 掌管，本分支不得手改
   `version`，任何记录也不得声称「npm 上的 `dsh-auth-gate@0.15.0` 已在 `0.2.0-rc.2` 上验证过」。
2. **走廊必须随一个新版本出海。** 在带加宽 peer 的插件版本发布之前，闸门会继续拒绝／跳过
   所有已发布版本。
3. **先插件、后宿主。** 在上述版本装好之前，生产不得先升到 dsh `0.2.x`：不兼容的 bundle 会被
   静默跳过，等于**摘掉登录门**（fail-open），而不是响亮失败。
