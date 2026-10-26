# 未配置实例用 dsh 的 launch token 进入首次配置向导

## 决定了什么

只在实例还没配置时认 dsh 的 launch token。全新安装后重启 dsh，浏览器打开启动日志里那条
`http://host:port/?token=<launchToken>`，不再停在 Access token 输入框，而是拿到一个 bootstrap
会话并进入 `/auth/setup` 向导：token 模式下生成并保存共享令牌，password 模式下创建第一个管理员，
做完就进 dsh。配置一旦成立，窗口立刻关闭：门先把请求转到 `/auth/bootstrap?token=...`，端点判定已
配置，再回 `302 /auth/login?next=%2F`，两跳都不下发 cookie、也不放行，旧 launch URL 当不了第二把
永久钥匙。

校验放在新端点 `GET /auth/bootstrap`。两个门（TokenGate / PasswordGate）只在本来就要 deny 的位置
多做一次形态判断：`GET` 加 pathname `/` 加恰好一个非空 `token` query，命中就返回
`{deny:{redirect:"/auth/bootstrap?token=..."}}`。门不比对 token、不读文件、不做 IO。探针、会话签发、
向导页全在独立端点里完成。bootstrap 会话 TTL 取 `min(sessionTtl, 3600)` 秒，只放行 `/auth/*`；
向导完成时先吊销全部 bootstrap 会话，再给当前响应签发正式会话，经 `/auth/continue` 复用 launch
token 桥回到 `/?token=`。

## 背景

出厂配置是 `mode: "token"`，靠 `DSH_AUTH_TOKEN` 解析共享令牌。全新安装时这个引用解析不到，门按
fail-closed 拒绝所有请求，于是谁都进不去，包括刚装好插件的人。dsh 自己每次启动会打印一条带 launch
token 的地址，`authorizeIndex` 认这条 URL 并铸出 30 天 cookie；但在 0.17.4 里，auth-gate 的门先一步
看到「没有会话、没有 Bearer」的请求，302 到登录页，launch token 根本没机会被 dsh 用上。结果装完重启
之后，用户还得开 shell 用 CLI 建管理员，或者手写 `DSH_AUTH_TOKEN` 再重启一次，这正是 issue #115
要取消的那一步。

同时有三条硬约束。`guard.ts`、`wrapServer` 与 `Gate` 词表已经冻结（D2、D27），不能为这件事改；
`next` 只取 pathname 的行为由 D-bridge-9 定下不改；本版不新增配置项、不动客户端，旧版 dsh（没有
`connection.authenticatedUrl`）的行为必须与 0.17.4 完全一致。

## 考虑过的替代方案

- **把 launch token 变成永久第二把钥匙**：`?token=` 永远能进，等于留一把绕过 TOTP 与密码的长效钥匙，
  削弱整套认证；何况 dsh 的 launch token 每个进程都换，它本来就不是能长期持有的凭据。
- **让守卫的 `next` 保留 search**：issue #99 提过，D-bridge-9 已否决，它把 launch token 反射进未认证
  的登录页 URL 与它的 Referer。
- **给 guard 加 `tryBootstrap` 钩子，或给 `Gate` 增加一种决策类型**：外部两版方案都走这条路，要动冻结
  的 `guard.ts` 与 `Gate` 词表，换来的只是少一个端点。
- **探针把「读不到配置」也算成未配置**：权限错误、YAML 解析失败都会进向导，等于一次读盘故障就把登录门
  打开，违反 fail-closed。
- **只在客户端面板里做入口**：bundle 没加载或页面打不开时就再次锁死，而那正是最需要恢复的情形。
- **加 `bootstrap: true/false` 开关**：多一个能把自己锁在门外的开关，还把回滚从「revert 代码」变成
  「改配置再 revert」，收益为零。

## 为什么这样选

- 未配置是可判定的：token 模式看凭据读取是否成功且返回空值（服务缺失或读取抛错算 `unknown`，不打开
  向导），password 模式看 `users.yaml` 是否缺失或零用户。配置一成立，这个判据自然为假，不需要再维护
  「引导已用完」这类状态。
  另外有一个进程内 `markedConfigured` 标志，向导写盘成功后窗口立即关闭，即使 credentials 服务有缓存、
  `resolveToken()` 暂时读不到新值。
- 门只做形态重定向，`guard.ts`、`wrapServer`、`Gate` 词表一行不改，风险面最小。全部 IO 与判定收在独立
  端点里，端点按顺序 fail-closed：缺 `sessions`、探针抛错、`connection` 缺失、`sessions.create` 抛错，
  一律回到「302 到 `/auth/login?next=%2F`」。
- 引导会话本身有边界：最长 1 小时，只放行 `/auth/*`，向导完成即吊销。它构不成一条能访问 dsh 的通道，
  所以「临时把人放进来」不会变成「临时把实例打开」。

## 后果与取舍

- launch token 会出现在 `Location: /auth/bootstrap?token=...` 里。它与原始请求 URL 里的 token 同级暴露
  （D-bridge-5 已经承认 launch token 会进访问日志与浏览器历史），这条件 302 带
  `referrer-policy: no-referrer`，不新增暴露类别。
- 引导通道假设单进程：launch token 每个进程各自随机，多副本没有粘滞路由时，`/auth/bootstrap` 可能落到
  不认识这枚 token 的进程，回落为登录页。
- credentials 服务若缓存旧值，向导里新保存的令牌要重启 dsh 才成为唯一凭据，结果页会写明这一点；窗口
  本身不等人，`markedConfigured` 立刻生效。
- 旧版 dsh（没有 `connection.authenticatedUrl`）没有引导：读不到 launch token，行为与 0.17.4 一致。
