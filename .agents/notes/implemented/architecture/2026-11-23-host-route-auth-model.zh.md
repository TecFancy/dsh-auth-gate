# Agent Note: 宿主路由鉴权是桥接，不是重写一份

Status: implemented

[English](2026-11-23-host-route-auth-model.md) | 中文

## Problem

dsh `0.2.3-alpha.2` 把请求鉴权从连接层搬到了路由表上。`WebRoute`、
`WebResourceRoute`、`WebUpgradeRoute` 与 `WebFallback` 都新增了
`auth?: 'anonymous' | 'required' | 'deny' | (request => policy)`，不写这个字段就是
`required`，而且 web server 在**分发之前**用 `webserver/authorize` 解析策略。旧宿主没有这个
概念：它只在边缘检查自己那枚 cookie，真正决定谁能进来的是本插件包住四类入口的守卫。

那条宿主线上三件事同时坏了：

- 插件为自己注册的每条路由（`/auth/login`、首次引导向导、改密页）都变成 `required`，
  于是本该拿到登录页的访客反而进不去。
- 宿主自己的 `required` 路由（`/`、`/index.html`、`/api/*`）在被包装的 handler 之前就被拒，
  守卫那记 `302` 登录跳转根本没发生；访客只看到宿主干巴巴的 `401`。
- 已登录访客有有效的 `dsh_auth` 会话，但没有宿主凭据，于是连门放行的路由也被宿主拒绝。

launch-token 桥与放行后的宿主 cookie 重铸分别建立在 `connection.authenticatedUrl` 与
`connection.requestRejection` 上；那条线把两者都删了，所以模型改变的当口，它们恰好无法
修补。

## Decision

插件在三个地方桥接两套模型，而不是把任何一套再实现一遍，每处只有一个所有者。

**自己的路由声明 `anonymous`。** `mountRoutes` 给每条 `/auth/*` 注册盖上
`auth: 'anonymous'`，因为这些页面本来就是调用方认证自己的入口。门依然判定它们全部 —
这个声明只是不让宿主抢在门前拒绝。旧宿主会忽略该字段。

**完整会话换一个 owner `Peer`。** `src/host-auth-wiring.ts` 通过
`ctx.inject(['connection', 'connection.authentication'])` 注册
`connection.authentication` 的 Provider，只对类别为 `full`、未吊销且未过期的会话返回
owner `Peer`。bootstrap 与受限会话一律 `undefined`，宿主保持它自己的 `401`；插件管理面内部
仍按角色细分。桥要同时声明两个服务：Cordis 4.2 拒绝从只注入了 `connection` 的上下文读取
`connection.authentication`，失败形态是抛出的服务访问错误，而不是 `undefined`。

**SPA 兜底只降级、不放宽。** `src/host/shared/guard/host-auth.ts` 在宿主自己的兜底
`auth` 规则外面套一层：宿主要求 `required` 时，请求带完整会话（索引渲染需要 `Peer`）或带
任何 `Authorization` 头（API 凭据不能被当成匿名导航）就保持 `required`，否则返回
`anonymous`，让被包装的门给出它惯用的 `302`。宿主规则求值抛错时按 `required` 处理。适配器
挂在注册对象上，所以随守卫一起回滚。

宿主有路由级鉴权模型时，launch-token 桥与重铸变成静默空操作，而不是告警「接缝缺失」：
进应用已经不需要宿主 cookie，接缝不存在并不是退化。

## Alternatives considered

**用 `webserver/request` 瀑布监听器接住宿主的 `401`，把未认证的文档导航重定向到登录页。**
能work，但它把门的策略复制到了第二处——监听器必须自己懂导航判定、受限与 bootstrap 类别、
`next` 编码和跨站弹回——而守卫不再是「谁被放行」的唯一所有者。兜底适配器保住了这个所有权：
它只决定由宿主还是由门来回答，从不决定谁被允许。

**让 SPA 兜底保持 `required`，用宿主的 `401` 页面当「请登录」界面。** 改动最小，但和产品
矛盾：宿主的页面提供 token 登录与设备配对，不是本插件的口令/TOTP/passkey 门；而且持有有效
`dsh_auth` cookie 的用户仍然进不去，还丢了 `next` 往返。

**照着宿主的 cookie 格式自己实现一个 token Provider。** 那个格式是未冻结的内部状态
（`dsh-auth-<sha256(authority)>`，用私有密钥签名），照抄会在宿主任何一次改动时静默失效，
这正是 launch-token 桥当初定下「丢弃 host 与 scheme」的同一条理由。

**在 Provider 里也承认裸的共享 token `Authorization: Bearer <token>`。** Provider 是同步的，
而令牌在异步 credentials 读取之后，要承认它就得在门前缓存一份凭据。拒绝：脚本登录一次复用
会话 cookie 即可，而带 `Authorization` 的请求永远不会被降级成匿名，失败方向仍然是关闭。该
取舍记入已知限制。

## Consequences

- 门仍然是插件自有面唯一的放行判定点。宿主的 `required` 路由现在放行任何完整会话 - 也就是门
  本来会放行的那一组 - 例外只有下面这条记录在案的收窄（裸共享 token 的 `Authorization` 头，
  同步 Provider 无法解析它）。
- 该宿主线上的首次引导失去了 launch token 这层证明：那枚 token 没有公开读取接缝，所以
  `/auth/bootstrap?token=…` 一律拒绝，第一个凭据必须来自 CLI（`dsh-auth user add`）或
  `DSH_AUTH_TOKEN`。对暴露该接缝的宿主，向导仍然存在。
- 该线上有一处行为收窄：若某次裸共享 token Bearer 请求打到宿主路由，门本来会放行，现在会收到
  宿主的 `401`。这是记录在案的已知限制，不是意外。
- `guardResource` 不再把「有 peer 参数」当成「进程内读」，而是要求请求完全不带请求头。那条
  宿主线上 `required` 的 resource 路由在网络路径上也会带 `Peer`，而网络请求至少有 `Host`，
  两种情况因此不必靠猜就能分开。
- dev/test 宿主队列移到 `0.2.3-alpha.2` 与 Cordis `4.2.0-alpha.1`，集成套件多了一条真栈
  用例：挂载 alpha.2 契约（`webserver/authorize` bail 加 Provider 注册表），验证登录跳转、
  带 `Peer` 的已登录索引渲染，以及 `/api` 的匿名 `401`。

## Deferred

四条已知后续项，记在这里，免得下一轮重新推导：

- **给进程内读一个显式标记。** `guardResource` 现在靠「有 `Peer` 且请求不带任何头」推断
  「调用方已经放行这个读者」；包一层 `webServer.readResource`、把它收到的 `Request` 标记起来
  会是更强的信号。当前推断对两个真实调用方都成立（LiveShare 构造裸 `Request`；网络路径必带
  `Host`），而标记法要在守卫今天并不拥有的方法上加一套包装纪律。
- **上一条宿主线上的 CI 腿。** 测试套件现在只跑在 `0.2.3-alpha.2` + Cordis 4.2 上；
  cordis peer 的 `^4.0.1` 以及 `0.2.2`/`0.1.x` 的兜底形状目前由单测与形状规则覆盖，没有真宿主启动。
- **按会话分配 Peer。** 今天一个共享 owner `Peer` 与旧语义一致（旧守卫也把任何完整会话放行到
  宿主面）。如果插件将来有了用户间权限，Provider 必须按会话映射 Peer 并在吊销时释放它；今天被吊销
  的会话在下一次 authorize 时就被拦下，但已经建立的 WebSocket 会继续跑。
- **通过 `webserver/entry-url` 读取 launch token。** 宿主确实会把带 token 的入口 URL 通过该事件
  发给监听器，首次引导向导因此可以在启动时捕获那一行来校验。这次没做，因为监听器顺序不是文档化契约。
