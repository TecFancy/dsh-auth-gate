# 放行后问一次宿主，不认就重铸它的浏览器 cookie

## 决定了什么

门给出 `allow` 之后、守卫调用原入口之前，对**到 `/` 的顶层文档导航**再问一次宿主：调用
`connection.requestRejection(request)`，它回 `401`（未认证）就 `302` 到相对 `/?token=<launchToken>`，
并随这次 302 下发一枚一次性标记 cookie（`dsh_auth_rebridge`，60 秒）。标记还在时不再重铸，
直接把请求交给原入口，让宿主自己回它的 401。

钩子只挂在 HTTP 入口（handler 与 resource 两种形态、存量与晚注册、fallback），WS 升级不挂：
握手没法用重定向修复。顺序上**跨站弹回排在重铸之前**：两者修的是不同的病，弹回修「Strict
cookie 存在但跨站导航不带它」，重铸修「cookie 名字对不上或已过期」；跨站导航里宿主必然回 401，
若先重铸，新签发的 Strict cookie 在整条跨站重定向链上照样不会被发送，反而把弹回本来能修好的
场景变成 401。

## 背景

dsh 有两层 cookie。外层是本插件的 `dsh_auth`（`SameSite=Lax`，默认 7 天），门只看它；内层是
`client-connection` 的 `dsh-auth-<sha256(authority)>`（`SameSite=Strict`，默认 30 天），由
`GET /?token=<launchToken>` 签发，名字与签名都绑定请求的 Host。门放行之后不再检查内层，于是
出现「门放行、宿主 401」：用户看到的是宿主那句 `dsh web authentication required`，而不是登录页，
刷新也修不好，因为门一直放行、永远到不了登录页。

2026-11-16 线上就是这么坏的：11-15 为了让 LiveShare 的 Origin 透传，Caddy 删掉了
`header_up Host 127.0.0.1:3080`，宿主 cookie 名从 `dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw`
变成 `dsh-auth-4C5y9yeEZVr1ky05miKn8P90w2IagA3Qrb7raNo49G0`，改动前登录的浏览器手里只有旧名字，
会话表里当时还有 93 条这样的有效会话。同类触发条件还有换域名或端口、宿主 cookie 过期、清站点数据。

## 考虑过的替代方案

- **在守卫里自己签 `dsh-auth-*`**：复制宿主的 cookie 名算法、HMAC 与 maxAge。这是未冻结的内部
  实现，dsh 一改就静默失效；issue #69 的维护者已明确拒绝这条路（"no in-tree mint of dsh-auth-*"）。
- **把宿主的 401 改成跳登录页**：要按状态码和正文识别宿主的响应，耦合它的文案；而且外层会话
  仍然有效，用户重新登录后桥会重铸，但桥本身坏掉时会变成反复登录。
- **只靠跨站弹回页**（D-2026-10-13）：弹回解决的是 Strict cookie 在跨站导航里不被发送，解决不了
  cookie 名字对不上——名字不对时同源重试照样 401。
- **无条件每次导航都跳 `/?token=`**：多一次往返，且 token 会进访问日志；没有标记时还会在宿主
  持续拒绝的情况下变成重定向环。

## 为什么这样选

`requestRejection` 是宿主文档化的接缝，描述就是「把 Connection 的 Host/Origin 检查与浏览器认证
应用到另一条 Web 路由」，只读请求头、不写响应，正好可以在放行之后问一次。用它意味着不复制任何
宿主内部格式：dsh 改 cookie 方案时，这个钩子跟着它的判定走，最坏情况是钩子失效、行为回到从前。

请求 URL 已经带着 `token` query 时不重铸：那一跳正是宿主在签发 cookie 的地方（登录桥每次
登录都会经过它），此时 `dsh_auth` 已生效而宿主 cookie 还没签发，`requestRejection` 必然回
401，重铸只会 302 到同一个地址，除了把 token 多写进一个 `Location` 头、每次登录多一跳之外
没有任何收益。

一次性标记把「重铸失败」的代价钉死在多一跳：第二次请求带着标记进来，钩子不再重铸，宿主的 401
原样交给用户。标记与会话 cookie 共用 `shared/http` 的 `buildCookie` 属性模板，`SameSite=Lax` 与
外层会话一致，所以它不会在跨站导航里丢失、也不会扩大任何授权面（它不参与任何判定，只表示
「刚刚重铸过一次」）。

只对到 `/` 的顶层 `GET` 导航生效，是因为重定向只对「浏览器会跟着走」的请求有意义：`/api` 的
fetch、静态资源、WebSocket 升级拿到 302 都没有用，只会把一次 401 变成一次无用的往返。`403`
也不重铸：那是宿主的 Host/Origin 围栏（`trustedHosts` 没配到这个 authority），换成 `/?token=`
走到同一个围栏上还是 `403`，重铸只是把一次清楚的 403 变成一次白跑的 302。

## 后果与取舍

- 宿主不认时，用户会看到一次额外的 302 往返（`/` → `/?token=` → 宿主 303 → `/`），之后正常。
  宿主认的时候零开销：只多一次同步的请求头判定，不读盘、不发网络请求。
- 钩子依赖 `connection.requestRejection`。没有这个方法的 dsh 版本上钩子停用并记一次 warn，
  行为与 0.20.0 完全一致。
- 重铸的 302 会把 launch token 放进 `Location`，与登录后的桥同一条既有约束（token 本来就会进
  访问日志，反代侧建议脱敏 `token=`）。
- 标记是 `HttpOnly` 且不参与判定，所以它不能被用来伪造任何状态；但它确实会让「刚重铸过」这件事
  在 60 秒内对同一浏览器可见，这是防循环的必要代价。
- 多副本且没有粘滞路由时，`/?token=` 可能落到不认这枚 token 的进程，重铸失败，用户看到宿主的
  401。这与登录后的桥是同一条既有约束，不是本次新增的限制。
