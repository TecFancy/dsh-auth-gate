# 守卫同时支持 handler 与 DSH 0.2.2 的 resource 路由

## 决定了什么

`wrapServer` 从现在起包装两种 HTTP 路由：旧的 `{ handler }`，和 DSH 0.2.2 新增的
`{ resource }`（Fetch `Request` 进、`Response` 出）。fallback 座位同样两种都认：函数，或
`{ resource }` 对象。三种注册方法、存量表、晚注册、二次包装、逐条回滚与启动自检都按同一套
目标函数身份工作，D27 的回滚语义一字不改。

route 类型建成联合：`WrappableRoute = WrappableHttpRoute | WrappableResourceRoute`，
`WrappableFallback = HttpHandler | { resource: ResourceHandler }`。运行期用
`typeof route.resource === "function"` 区分，旧宿主没有这个字段，永远走原来的 handler 分支。

`Gate.decide()` 的入参从 `IncomingMessage` 收窄成 `GuardRequest`，也就是只取 `url`、`method`
和 `headers` 三项。node:http 的 handler 入口天然满足它；resource 入口由 `toGuardRequest()`
逐项复制请求头和这两个字段，再交给门。门因此不需要也不应该依赖 socket 之类的 Node 专有字段。

拒绝路径抽成传输无关的 `GuardReply`（status、headers、body）：`denyReply()` 只算一次，
handler 用 `writeGuardReply()` 写 node 响应，resource 用 `guardReplyToResponse()` 转成 Fetch
`Response`。302 的 Location 消毒、401/403 文案、`no-store`、`referrer-policy` 都只有一份实现。
放行路径不经过这个模型：原 `Request`、`peer` 和原 `Response` 原样转发，不读、不克隆、不解压
响应体。

`assertGuarded()` 对两种入口都检查 `handler` 或 `resource` 上的守卫标记，fallback 既认函数也认
`.resource`。

## 背景

DSH 0.2.2-rc.1 的 `webServer` 新增了 `WebResourceRoute`：路由可以带 `resource`，接收 Fetch
`Request` 并返回 `Response`。官方自己的两处入口立刻换了形态：`@deepseek-ai/dsh-client-modules`
把 `/plugins` 注册成 resource prefix，`@deepseek-ai/dsh-host-frontend-static` 的 SPA 兜底改成
`{ resource }`。

本插件的 `wrapServer` 假设每条路由都有 `handler`。拿到 `undefined` 之后读守卫 symbol 抛
`TypeError`，entry 未激活；而 0.1.6 之后的启动审计只把七个必需 id 当致命错误，进程照起、页面
照开，登录门整个消失。这是 fail-open，属于最坏的一类坏法：看起来一切正常，实际没有认证。
崩溃前已被包了一半的路由还会留下半守卫状态，API 面返回 401。

## 考虑过的替代方案

- **把 peer 下限提到 `>=0.2.2`，只支持新宿主**：会放弃 0.2.0 与 0.2.1 的全部用户，而同一份代码
  用运行期探测就能服务三代宿主，没有必要收窄。
- **把 Fetch `Response` 转成假 `ServerResponse`，或者把 resource 模拟成 node handler**：会丢掉
  `Request`/`Response` 的语义，容易在流式 body、gzip、Range 上出偏差，还要维护一个假的
  `IncomingMessage`。
- **放行时 buffer 响应体再重新包装**：破坏流式与压缩，也白白增加内存与延迟；直接返回原
  `Response` 最安全。
- **只改 `lib/` 里的编译产物**：能救一次运行，但不可发布、不可测试，下次构建即丢。
- **在 `await` 之前先判 `route.handler !== undefined`，没有就跳过**：跳过等于不守卫，`/plugins`
  与整个 SPA 兜底会裸奔，正是这次要修的问题。

## 为什么这样选

拒绝语义只写一份，两种传输共享，行为不会漂移；放行路径零拷贝，性能与语义都不变。运行期探测
让同一份包同时服务旧宿主与新宿主，`peerDependencies` 与 `engines.dsh` 保持原范围，消费者不用
迁移。结构镜像与 `GuardRequest` 都不 import 0.2.2 的独有类型，老版本加载时不会因为找不到导出而
失败。启动自检继续 fail loud：只要还有一个入口不带守卫标记，`apply` 就抛错，不会静默半挂。
