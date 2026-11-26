# Agent Note: 登录限速改为受理制并分区计数

Status: implemented
Legacy ID: D39

[English](2026-11-22-admission-based-rate-limiting.md) | 中文

## Problem

登录限速器「连续失败 5 次即锁定」的保证只对**串行**请求成立。检查、口令验证与失败记账之间隔着
await，中间没有任何东西预留名额，所以一波并发请求可以在任何失败被记下之前全部看到「未锁定」。桶的
记账还有两个洞：TOTP 与口令阶段共用 `(ip, username)` 桶，一次正确口令就把它清掉，于是已经掌握
口令的攻击者只要重贴一次口令就能重置猜码计数；而锁到期的桶会把 `failures` 清零，`maxDelaySeconds`
的上限永远到不了，实际速率永远停在每个 `baseDelaySeconds` 五次。任何成功登录还会清掉共享的 IP 桶，
一个合法账号就能洗白某个 IP 的失败历史。这些都不是串行测试能看见的：测试全绿，而进程内限速器只在
「一次只有一个请求」的前提下兑现承诺。

## Decision

`LoginRateLimiter.admit(ip, account, scope)` 在一个同步段里完成锁定检查、在途预留与桶查找，返回一个
结算句柄。登录处理器在做任何凭证工作之前先预留名额，并且只结算一次，结果是 `success`、`failure` 或
`abandon`（`finally` 里结算 `abandon`，它只释放名额）；失败记进桶，成功清账号桶。判断是否受理时，
已预留的名额按失败计数，所以并发请求不可能同时穿过「失败 5 次」这道门。

桶按认证域 `scope` 分区：`login`、`totp`、`passkey`、`token`、`password-change`、`admin`。只有持有
某个域的阶段才会写它，所以完成口令阶段不再清 TOTP 的猜码计数；`clearAccount()`（管理员重置）会清
该账号在所有域里的桶。

退避由 `strikes` 计数驱动，锁到期不清它，只有 `windowSeconds` 的静默窗口才清。第 n 次打击
（n >= `maxFailures`）锁定 `baseDelaySeconds * 2^(n - maxFailures)`：账号桶封顶
`maxDelaySeconds`（900 秒），IP 桶封顶更低的 `ipMaxDelaySeconds`（120 秒）——见
[共享出口锁定封顶](../architecture/2026-11-26-shared-egress-lockout-ceiling.zh.md)。条目超过 10000
上限时，驱逐按锁定最早到期、失败数最少排序，永不驱逐还有在途预留的桶，并把仍然有效的锁定桶排到
末尾，所以轮换攻击者冲不掉它们。一次成功受理只结清账号桶，登录永远不会清 IP 桶。

超过 `maxConcurrentPerIp`（每个 IP 每个域 32 个在途尝试）的受理请求会得到 `retry-after: 1`；这是
并发保护，不是锁定。一旦某个桶的失败预算花完，它下一次受理只放一条探测——IP 桶同样如此：来自同一
地址的一批不同用户名不能一次结掉一整个锁定量的打击。状态仍在进程内，重启清零（`TODO(auth-m5)`）。

## Alternatives considered

- **把登录处理器串行化到一把按账号的异步锁后面。** 拒绝：锁会横跨 scrypt 与 TOTP 的 await，
  把并发变成排队，还给登录路径加上死锁/超时的面。同步的「预留 + 结算」句柄在不跨 await 持锁的
  前提下给出同样的受理保证。
- **只给 TOTP 单独一个桶，继续用 `check`/`recordFailure`/`recordSuccess` 作为唯一 API。**
  拒绝：分区才是通用修法——passkey 与 token 同样是独立的认证域——而旧的一对仍然在成功时清 IP
  桶，那正是洗白缺陷。
- **让 `check()` 加 `recordFailure()` 变成原子操作，而不是新增 `admit()`。** 拒绝：它们保留给已认证
  的管理面与改密面，那些不是暴力破解入口，成功时清两个桶在那里是对的；改写它们只会把那些流程
  拖进它们并不需要的预留模型。

## Consequences

「失败 5 次」策略现在能约束并发尝试，文档承诺的 `maxDelaySeconds` 升级真实存在，TOTP、passkey 或
token 尝试也不会再被一次成功的口令阶段重置。代价是限速器多一套调用协议（`admit` + `settle`）和一
个有界受理队列：同一 IP 同一域同时超过 32 个尝试就会拿到 `retry-after: 1` 而不是做凭证检查，所以
被限流的调用方会重试，而不是读到锁定文案。状态在进程内，所以重启仍会清空所有锁定与打击历史；
[受信反代笔记](2026-09-22-trusted-proxy-client-ip.zh.md)仍然决定桶按哪个地址计数。
