# Agent Note: An in-process read carrying a Peer is admitted by its caller

Status: implemented

[English](2026-11-19-peer-reads-admitted-by-caller.md) | 中文

## Problem

dsh 0.2.2 的 `webServer.readResource(request, peer)` 让进程内调用方拿到「同一 URL 经 HTTP 会收到的响应」，而不必走一次 HTTP 往返。它的契约写得很清楚：调用方已经放行这个读者再读——方法本身不检查 cookie、Host 或 Origin，它收到的 `peer` 就是那次放行。`dsh-experimental-liveshare` 正是这样提供 owner 的 viewer 页面：分享宿主用读者的 `Peer` 读首页和每个 shell 资源，再把字节交给 relay。

守卫却把这条 resource 当成普通 HTTP 入口，先问门。门的判定需要凭证，而进程内的请求什么凭证都没有：没有 `dsh_auth` cookie，没有 `Authorization`，没有 `Sec-Fetch-*`。口令门于是把它归为「匿名、非导航」的请求，回 `401 unauthorized`；owner 的 asset 回答随之变成 `401 {"error":"asset-not-found"}`；relay 再把它折叠成 `503 the host is offline or the page could not be loaded`。

2026-11-19 的 LiveShare 故障就是这么来的：访客在 relay 登录成功、owner 也在线，页面仍然打不开，因为拒绝发生在 owner 自己的进程里——门拦住了 owner 读取它马上要发出去的那一页。宿主本来就把两种情况分开了：`dsh-host-frontend-static` 只在 `peer === undefined` 时才授权首页，并用 `peer ?? browserPeer` 渲染；而守卫包住同一个 fallback，却只拿 `Request`、把 `peer` 丢掉了。

## Decision

`guardResource` 把 `peer` 的存在当作「调用方已经放行读者」的证据：

- `peer !== undefined` 的读在问门之前就原样交给原 resource，连同原 `Request` 和原 `Response`。
- 放行之后那几个只对浏览器有意义的动作一并跳过：代理标记围栏、跨站弹回、重铸钩子，以及 `onAdmit` 匿名统计钩子。它们没有浏览器可作用；把一次进程内读算成一次被放行的浏览器请求，只会虚增使用统计。
- 非法 URL 的 400 留在旁路之前：解析不了的 URL 仍然回 `400`，因为宿主自己的读也会拒绝它。

这条旁路不新增任何权限。`readResource` 只能从宿主进程内部调用；那里的调用方本来就能从磁盘读 dist 文件、直接调用 resource。本插件守的信任边界是浏览器，不是别的插件。

## Alternatives considered

- **让读带上 owner 的 cookie。** relay 从来没有 owner 的 cookie——owner 是通过自己的 WebSocket 隧道跟它讲话的——凭空造一个等于把协议从未授予的 owner 级权限交给 relay。
- **只豁免首页（`/`）。** shell 资源（`assets/...`）走同一条 `readResource`，页面还是会在第一个脚本上失败；读者的权限来自 `peer`，不来自路径。
- **让 dsh 加一个门认识的标记头。** 那是宿主侧改动，只能随宿主的发布节奏上线，而且等于在宿主已经提供的 `peer` 旁边再造一套放行机制。
- **对分享关掉门，或干脆不用它。** 为了修一种入口，把整个实例的浏览器认证拿掉。
- **让 owner 不用 `readResource`、自己发页面字节。** owner 得重新实现首页渲染和资源服务，正是宿主这条读缝想要避免的漂移。

## Consequences

- 门后面的 LiveShare viewer 页面能用了：首页与 shell 资源都以被放行的读者身份读。真实 `@deepseek-ai/dsh-host-webserver` 栈上的集成测试覆盖了这一点（带 `peer` 的读拿到 fallback，同一 URL 走 HTTP 仍是 `401`，不带 `peer` 的进程内读仍被拒）。
- 浏览器路径没有变化：没有 `peer` 时守卫与以前完全一样——拒绝、重定向、跨站弹回、重铸、放行钩子。
- 有一处耦合要盯着：如果将来的 dsh 为来源是 HTTP 的请求也传 `Peer`，那个请求就会绕过门。今天 `serveResource`（HTTP 路径）不传；真变了，守卫需要一个新的判别依据，而不是这个「存在即放行」。
- 进程内读不再出现在匿名使用统计里。那个计数按定义是浏览器请求数，把 owner 内部读页面算成使用量本来就是错的。
