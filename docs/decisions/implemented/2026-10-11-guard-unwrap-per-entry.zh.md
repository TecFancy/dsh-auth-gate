# 守卫的 unwrap 逐条回滚，不按快照整表还原

## 决定了什么

`wrapServer` 返回的 disposer 逐条回滚：`exact` / `prefixes` / `upgrades` 中的条目（以及 `fallback` 槽位）只有在当前仍是**本次 wrap 产出的守卫 handler** 时，才换回未守卫的原 handler。守卫挂载期间被删除的条目不写回，被别人替换的条目不动，wrap 之后注册的路由留在表里、只摘掉守卫。本记录取代 `docs/implemented/impl-m1.md` D6 中「还原 = 恢复快照 + 原方法，post-wrap 期间新增的注册随还原丢弃」这一条。

## 背景

M1 的 disposer 清空路由表，再写回 wrap 时拍下的快照。这只在整个宿主关停时正确。dsh 会就地重载单个插件（在 Plugins 页改配置 = 只对这个插件 dispose + apply），而真实的 `@deepseek-ai/dsh-host-webserver` 遇到重复 path 或第二个 fallback 会直接抛错。于是单独重载 dsh-auth-gate 会：

1. 抹掉其他插件在 wrap 之后注册的全部路由（直到整体重启前都是 404）；
2. 复活拥有者已卸载的路由，handler 指向已销毁插件的闭包；
3. 让该拥有者下次加载时报 `webserver: duplicate exact route`，因为被复活的条目仍占着这个 path。

`src/integration.guard.test.ts`（"guard survives a reload of this plugin alone"）在真实 cordis 与 webserver 上复现了全部三种后果。

## 考虑过的替代方案

- **保留快照还原（M1 D6）**：拒绝。它接管了属于其他插件的状态，单插件重载就会把它们弄坏。
- **快照还原 + 合并 wrap 之后的注册**：拒绝。仍会复活已卸载的路由，而且同一 path 两边冲突时只能猜谁赢。
- **dispose 时保留表里的守卫，只还原注册方法**：拒绝。残留守卫会继续调用已销毁的 gate，下一次 wrap 也分不清哪些是自己的守卫、哪些是残留。

## 为什么这样选

守卫只拥有它自己创建的 handler，回滚就应该只碰这些。每次 wrap 在自己作用域内的 WeakMap 里记录「守卫 handler → 原始路由」，一次查表就能回答「表里此刻这一条是不是本次 wrap 产出的」，这正是回滚唯一需要的事实。path 本身的所有权仍归注册它的插件，它们自己的 disposer 照常有效，因为真实 webserver 按 path 删除。
