# 跨站顶层导航先回一张同源弹回页

## 决定了什么

gate 已放行、且请求是跨站顶层文档导航（`GET` + `Sec-Fetch-Site: cross-site` +
`Sec-Fetch-Dest: document`）时，`guardHttp` 不调用原 handler，而是回 `200` 和一张静态小页面：
唯一的脚本是 `location.replace(location.href)`，CSP 钉死该脚本的 sha256，另带
`cache-control: no-store`、`referrer-policy: no-referrer`、`x-content-type-options: nosniff`。
第二次请求由同源文档发起，带 `Sec-Fetch-Site: same-origin`，随请求送出 dsh 的
`SameSite=Strict` cookie，也不会再命中判定。deny 路径与升级（WS）路径不变；无 JS 的浏览器由
`<noscript>` 里 `href` 为空的链接兜底。

## 背景

外层会话 cookie `dsh_auth` 是 `SameSite=Lax`；dsh web 自带的内层 cookie `dsh-auth-<hash>` 是
`SameSite=Strict`。跨站顶层导航（别的站点点链接、`127.0.0.1` 跳 `localhost`）只带 Lax cookie：
gate 放行，随后 dsh 回 `401 dsh web authentication required`。Chrome 刷新时沿用原来的跨站上下文，
F5 永远修不好，只有重新手输地址的新导航才行。跨站的 `/?token=...` 同样失败：dsh 签发 Strict
cookie 并 303 到 `./`，但整条重定向链仍是跨站，新 cookie 照样不被发送。

## 考虑过的替代方案

- **外层 cookie 也改成 `SameSite=Strict`**：同一次导航会被 gate 拒掉并跳登录页，用 401 换成每次跨站进入都要重新登录。
- **插件改写内层 cookie**：内层 cookie 归 dsh 所有，碰它等于耦合宿主内部实现。
- **用 `302`/`303` 重定向回同一 URL**：重定向保留跨站发起者，Strict cookie 仍然不发。
- **把请求 URL 插值进页面**：白白增加反射面（URL 可能带 dsh 的 launch token）；脚本用
  `location.href` 就能拿到 URL。

## 为什么这样选

只有同站文档发起的导航才算同站，所以从我们自己的源站回一张页面，是改变请求上下文的最小手段。
以 `Sec-Fetch-Site: cross-site` 作触发条件，使弹回在构造上不会循环（重试是 `same-origin`），
头缺失则保持现有行为。页面是不含请求数据的常量，CSP 哈希在模块加载时由脚本原文算出，两者不会漂移。

## 后果与取舍

- 对顶层 `GET` 文档导航，弹回实际上把 dsh 内层 `SameSite=Strict` cookie 的保护降到 `SameSite=Lax`
  强度：跨站链接多一跳同源导航后，两个 cookie 都会送到 dsh。这是有意为之：外层 gate cookie 本来就接受
  这类请求，而 dsh 的写操作面不经顶层 `GET` 可达（`/api` RPC 端点只收 `POST`，宿主的 `GET` 路由都是只读的；`/?token=` 仍需不可猜的
  launch token）。非 `GET` 方法、iframe 与子资源请求仍保持完整的 Strict 行为。
- 只要 gate 放行就会弹回，包括 `/auth/login` 这类未登录也可访问的公开路径；页面是常量，代价只是多一次
  往返，不泄露任何信息。
