# 术语表

本表约定本仓库中英术语的统一译法。它是中文写作规则的术语真源，由 `npm run zh:prose` 直接执行。

**通用规则：**

- 「中文」列是中文正文的默认用词。该列写英文（或标了「保留英文」）时，中文正文同样保留英文，不翻译。
- 「首次出现」列只在文档里第一次出现时照写（带英文括注）；之后只写括号前的部分。
- 「不要译作」列是门禁执行的硬禁止：**只放真正不能用的写法**，会造成歧义、或把两个概念混成一个词的那种。可接受的同义表达写进「备注」，靠评审统一，不靠报错。
- 门禁按**子串**匹配禁令，所以别把会嵌在别的词里的写法放进来。
- 表里没有的技术术语：先找权威先例（MDN 中文、Kubernetes 中文、Vue 中文文档、微软简中风格指南），并在 PR 里注明出处；找不到先例就保留英文，同时进文末「待定术语」并附一条建议译法。禁止在正文里临时自创译法。
- 术语一旦确定，就在同一次 PR 或下一次 PR 里补进本表。

## 文档体系

| English | 中文 | 首次出现 | 不要译作 | 备注 |
| --- | --- | --- | --- | --- |
| Agent Note | 笔记 | 笔记（Agent Note） | 智能体注记、智能体笔记 | 中文侧的 H1 机器前缀保持英文 `# Agent Note: `，标题里不加括注；泛指用法的 `Agent Note` 保留英文 |
| note tree | 笔记树 | | 便签树 | 承载 proposed / implemented / rejected / archived 四类笔记的目录 |
| decision record | 决策记录 | | 决策笔记 | 旧写法已在本次改动中统一 |
| standing rule | 常驻约定 | | 常设规则 | `docs/conventions.md` 是它唯一的家 |
| work order | 工作令 | | 工单 | 执行用的步骤清单；与 issue 无关，不进仓库 |
| proposal | 提案 | | 建议书 | `proposed/` 里的未落地决策 |
| rejected note | 被否决的笔记 | | 被拒绝的笔记 | 否决理由写在 `Status:` 行 |
| archive | 归档 | | 存进档案库 | 冻结的历史快照，永远不再改写 |
| frozen | 冻结 | | 冰封 | 状态：不再演进 |
| sealed | 封存 | | 锁死 | 动作：内容封印，哈希可核 |
| re-record | 重录 | | 再次录制哈希 | 重新录制 `.i18n.yaml` 里的两侧 blob 哈希 |
| bilingual pair | 双语配对 | | 双语对 | 英文 + 中文 + sidecar 三件套 |
| sidecar | sidecar | | 边车文件 | 保留英文；指 `.i18n.yaml` |
| structural signature | 结构签名 | | 结构指纹 | 围栏代码块、表格维度、列表形状、链接目标 |
| reachability | 可达性 | | 可到达性 | 从入口沿链接能否走到 |
| orphan document | 孤儿文档 | | 孤立文档 | 从任何入口都走不到的文档 |
| red line | 红线 | | 红线值 | 硬上限，超了必须处理 |

## 认证与安全

| English | 中文 | 首次出现 | 不要译作 | 备注 |
| --- | --- | --- | --- | --- |
| auth gate | 认证门 | | 认证网关、鉴权门 | 本插件的核心 |
| guard | 守卫 | | 防护器、守卫器 | 包装 `webServer` 的那一层 |
| gate | 门 | | 闸门 | `Gate` 接口的实现，做 allow/deny 决定 |
| fail closed | 失败即关闭 | 失败即关闭（fail-closed） | 失败关闭、默认拒绝 | 凭证无法确认时恒 deny |
| fail open | 放行 | 放行（fail-open） | 失败开放 | 凭证无法确认时 allow，本仓库明确不做 |
| deny | 拒绝 | | 否决 | 门的决定 |
| allow | 放行 | | 允许通过 | 门的决定 |
| session | 会话 | | 会话期 | |
| session store | 会话存储 | | 会话仓库 | |
| credential | 凭证 | | 凭据 | |
| token | token | | 令牌 | 保留英文 |
| shared token | 共享 token | | 共享令牌 | token 模式 |
| password | 口令 | | 密码 | 指登录口令时用「口令」；指密码学哈希时保留「密码」 |
| passkey | 通行密钥 | 通行密钥（passkey） | 密钥、生物密钥 | WebAuthn 凭证 |
| TOTP | TOTP | | 动态口令 | 保留英文 |
| challenge cookie | 挑战 cookie | | 质询 cookie | 两段式 TOTP 的状态载体 |
| rate limit | 限速 | | 速率限制、频率限制 | |
| trusted proxy | 受信反代 | | 可信代理 | |
| client IP | 客户端 IP | | 客户 IP | |
| cross-site navigation | 跨站导航 | | 跨域跳转 | |
| bounce page | 弹回页 | | 跳转页、回弹页 | 同源弹回 |
| session revocation | 会话撤销 | | 会话吊销 | |
| scrypt | scrypt | | 加密算法 | 保留英文 |
| hash | 哈希 | | 散列 | |
| constant-time comparison | 恒时比较 | | 常量时间比较 | |
| HMAC signature | HMAC 签名 | | 签名校验 | |
| threat model | 威胁模型 | | 威胁建模 | |

## 工程与流程

| English | 中文 | 首次出现 | 不要译作 | 备注 |
| --- | --- | --- | --- | --- |
| gate (CI) | 门禁 | | 关卡、检查点 | 与「门」（认证门）区分：门禁指脚本检查 |
| gate registry | 门禁注册表 | | 门禁清单 | `scripts/lib/gate-registry.mjs` |
| gate runner | 门禁 runner | | 门禁运行器 | 保留 runner |
| self-test | 自测 | | 自我测试 | 门禁的负例测试 |
| negative case | 负例 | | 反例 | 门禁存在的意义就是拒绝的输入 |
| change surface | 改动面 | | 变更范围 | 按改动面选场景 |
| scenario | 场景 | | 情景 | `hygiene / types / tests / build` |
| pre-commit | pre-commit | | 提交前 | 保留英文 |
| pre-push | pre-push | | 推送前 | 保留英文 |
| build artifact | 构建产物 | | 构建制品 | `lib/` |
| parity | 一致性 | | 对等性 | 提交产物与全新构建一致 |
| release-please | release-please | | 发布机器人 | 保留英文 |
| squash merge | squash 合并 | | 压缩合并 | 保留 squash |
| promotion PR | promotion PR | | 提升 PR | 保留英文；`development` → `main` |
| branch hygiene | 分支卫生 | | 分支规范 | |
| lockfile | 锁文件 | | 锁定文件 | `package-lock.json` |
| peer dependency | peer 依赖 | | 对等依赖 | 保留 peer |
| host corridor | 宿主走廊 | | 宿主范围 | `engines.dsh` 与 peer 的兼容区间 |
| slice | slice | | 切片 | FSD 术语，保留英文 |
| layer | 层 | | 层级 | FSD 术语 |
| segment | segment | | 分段 | FSD 术语，保留英文 |
| public API | 公共 API | | 公开接口 | 经 `index.ts` 的出口 |
| barrel | barrel | | 桶文件 | 保留英文；`index.ts` |
| cross-half contract | 跨半边契约 | | 跨端契约 | `src/protocol/` |
| host half | host 半边 | | 宿主端 | 保留 host |
| client half | client 半边 | | 客户端 | 保留 client |
| wiring | 接线 | | 装配、连线 | 根目录的 `*-wiring.ts` |
| entry point | 入口 | | 入口点 | |
| real entry path | 真实入口路径 | | 真实入口 | 集成测试从真实路由进入 |

## 待定术语

| English | 建议译法 | 状态 |
| --- | --- | --- |
| （暂无） | | |
