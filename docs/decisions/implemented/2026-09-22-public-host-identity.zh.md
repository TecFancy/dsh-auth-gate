# D14. 身份块 host 走 publicHost 配置（空值回退请求头 Host）

## 决定了什么

新增配置项 `publicHost: string`（默认 `""`）与共享判定
`src/shared/host.ts` 的 `resolvePublicHost(publicHost, requestHost)`：配置非空则用它，
为空则回退请求头 `Host`。登录页三个变体（token / password / TOTP）的身份块渲染点
统一走这个函数；`AuthConfig` 是唯一配置入口，两个模式的端点依赖里各加一个
`publicHost?: string` 字段（缺省即回退，向后兼容）。顺手做运维容错：粘成
`https://host/path` 会被归一化成 `host[:port]`。该值**只决定展示文本**，不参与任何
鉴权判定；转义与 253 字符截断仍在渲染层（`login-page.ts`）完成。

## 背景

登录页的反钓鱼身份块把「你正在访问哪个实例」渲染在卡片上，用户靠它与地址栏的一致性
识别钓鱼页。它的取值来自 `req.headers.host`，这在直连或原样透传的拓扑下是对的，
但线上是**半外壳反代**：

```
dsh.example.com { reverse_proxy 127.0.0.1:3080 { header_up Host 127.0.0.1:3080 } }
```

Caddy 把 `Host` 改写成回环地址（历史原因：让 dsh 的 privileged API 栅栏认为请求来自
loopback），于是远程用户访问 `https://dsh.example.com` 时，卡片上写着
`127.0.0.1:3080`——与地址栏不一致，正好把反钓鱼的意图做反。隔离实例实测复现
（`web-test` profile，请求打 127.0.0.1:3081，卡片显示 127.0.0.1:3081）。

## 考虑过的替代方案

- **读 `X-Forwarded-Host` / `X-Forwarded-Proto`** —— 请求方可伪造，与 P10「不读 XFF」
  同一纪律冲突；身份块是安全语义展示，不能建立在可伪造输入上。
- **改反代配置为透传原始 Host（删 `header_up Host`）** —— 语义更干净，但会牵动既有
  的 loopback 栅栏、`--trusted-host` 与 launch-token 桥的行为，属于动生产环境，
  不该由一次 UI 改动顺带决定。
- **照旧读 `Host`，只写文档说明** —— 卡片会长期显示回环地址；反钓鱼功能等于失效，
  而用户看到的第一屏正是这个卡片。
- **让身份块显示 dsh 的 `--trusted-host` 值** —— 宿主没把这个值透出给插件，
  为它去探宿主内部结构不划算。

## 为什么这样选

运营侧配置是唯一既不可被请求伪造、又不需要动生产拓扑的来源；「空值回退请求头 Host」
让所有现有部署（直连/原样透传）行为零变化，是纯增量。归一化只做一层薄薄的容错
（剥 scheme 与路径），不引入 host 合法性校验——渲染层已经负责转义与截断，
真正的域名合法性由运营者自己写对。

遗留：`publicHost` 只影响展示。若将来要让重定向、cookie 域或 launch-token 桥也
跟随对外域名，需要单独决策（那些是行为改动，不只是展示）。
