# D23. 口令策略（≥14 位四类字符）与 users.yaml 变更面（独立锁 + CAS）

## 决定了什么

**1) 口令策略独立成 shared 叶子模块 `src/shared/password-policy.ts`：**

- `PASSWORD_MIN_LENGTH = 14`、`PASSWORD_MAX_LENGTH = 256`（上限防超长输入拖慢 scrypt；16 KiB
  的请求级 413 只是兜底，不是策略）；四类字符 = `[A-Z]` / `[a-z]` / `[0-9]` / 非字母数字
  （special）；`sameAsOld` 判定新口令不得等于旧口令。
- 规则枚举 `PasswordRule = "minLength" | "maxLength" | "uppercase" | "lowercase" | "digit" |
"special" | "sameAsOld"`，返回值 `{ ok, rules }`，`rules` 是未通过项、按枚举顺序排列
  （端点直接把它当 400 `policy` 的 `rules` 数组返回）。
- **校验顺序 = 长度 → 字符类 → 旧哈希**（最贵的放最后）；长度不过时**不跑**旧哈希比较。
- `sameAsOld` 用**注入的比较器**判定：`checkPasswordPolicy(newPassword, opts?: { oldPasswordHash?,
verifyOld? })` 返回 `Promise<PasswordPolicyResult>`。这样 shared 层不 import 上层 feature
  （分层硬规则），哈希比较仍复用生产上的 `verifyPassword`。
- **不 trim、不截断、不做 NFKC 归一化**：口令是原样字节，客户端与 CLI 都不做「顺手清理」，
  NFKC 会作废存量哈希，本期明确不做。

**2) `users.yaml` 的所有变更收敛到锁内的 read-modify-write：**

- **锁是独立文件 `users.yaml.lock`，绝不锁在 `users.yaml` 本身**：现有写入是 tmp→rename，
  rename 会换 inode，锁在旧 inode 上等于没锁。锁用 `fs.open(lock, "wx", 0o600)` 写入
  `{pid, host, token, startedAt}`（`token` 为随机值），零新依赖。
- **释放锁必须带 owner 校验（compare-and-unlink）**：`finally` 里先读回 lock 文件、比对 `token`
  一致才 `unlink`。否则本进程的锁被判 stale 抢走后，原持有者的释放会误删新持有者的锁，两个
  写者同时进入临界区（双写）。**0 字节或 JSON 损坏的 lock 文件按 stale 处理**，不能因为
  `JSON.parse` 失败就一路 wedge 到超时。测试覆盖「抢锁后原持有者释放不删新锁」。
- 取锁失败（EEXIST）时读锁文件比 mtime 与 pid（`process.kill(pid, 0)` 判活，ESRCH = 死）：
  超过 `staleMs`（默认 10 s）或 pid 已死则删锁重试，否则退避重试到 `timeoutMs`（默认 5 s），
  超时抛 `UsersFileError("users file is locked by another process")`。**任何失败路径都不得留锁**
  （进程被杀留下的死锁由 staleMs 兜底）。
- **已知残留：陈旧锁的夺取不是原子操作**。夺取路径是「删旧锁 + 建新锁」两步，而建锁本身还有
  「已创建、payload 尚未落盘」的微秒级空窗，理论上两个进程可能同时认为自己持有锁（写前 CAS
  与 compare-and-unlink 是第二道防线，但消除不了这个窗口）。修复方向（P2 候选）：建锁改成
  `tmp + link()`、夺取时用 rename 原子认领。如实记录，不美化。
- 锁内：现读文件（不存在视为空快照）→ 记 `before = {mtimeMs, size}` → 跑 `mutator` →
  **写前 CAS**：再 stat 一次，与 `before` 不一致就**重读并重跑 `mutator`**（≤ `attempts`，
  默认 3 次，因为改密 mutator 会在新快照上重新校验旧 hash，重跑是安全的）；超过重试上限抛
  `UsersFileError`（端点上表现为 503），绝不覆盖写。
- **锁内临界区的实测代价**：锁内包含一次 scrypt 复核（实测约 100 至 200 ms），最坏情况
  （CAS 冲突重跑 3 次）约 600 ms，相对 `timeoutMs`（5 s）与 `staleMs`（10 s）仍有一个数量级
  余量，因此「把 scrypt 放进锁内复核」是可接受的取舍；换来的是绝不覆盖他人的并发写入。
  mutator 内不得再添加任何慢操作。
- 写前留 `.bak`（0600、滚动一份；`.bak` 写失败不阻断主写）→ 原子写（tmp + rename，0600）→
  `finally` 释放锁。所有新错误统一 `UsersFileError`，message 面向操作员。
- 唯一公共面：`mutateUsersFile(filePath, mutator, options?)` 是 CLI 与端点的**唯一变更入口**；
  原有 `writeUsersFile` 语义不变，保留给测试与低层使用。
- **last-admin 不变量**：写前校验，若变更后「`role === "admin" && !disabled`」的用户数从 > 0
  变为 0，抛 `UsersFileError("cannot remove the last admin")`。`user disable` 与 `user role ...
user` 因此自动受保护。

**3) 角色模型与本期边界：**

- schema `.strict()` 扩展两个 key：`role`（`"user" | "admin"`，缺省 `"user"`）与
  `must_change_password`（boolean，缺省 `false`）；**默认值不落盘**（`user` / `false` 不写字段），
  既有 fixture 的 YAML 字节不变；`version: 1` 不变。
- **提权只走 CLI**：`dsh-auth user role <name> <admin|user>` 是唯一角色通道，另外
  `dsh-auth user add --admin` 可在建号时直接建管理员；**本期不开任何 HTTP 提权面**。
- **`must_change_password` 本期只预留字段**：登录路径不读它，不做强制改密分流（见 D22 的
  替代方案）。预留保证 P2 的管理面只加不返工。
- CLI 变更面：`dsh-auth user passwd <name> [--password-stdin] [--file <path>]`（**严禁
  `--password` 明文参数**；顺序 = 用户存在 → 策略（`sameAsOld` 传入现 hash）→ `hashPassword`
  → `mutateUsersFile` 锁内写 → 输出 `user <name> password changed`；TOTP 用户给出「改密不影响
  验证码，但需重新登录」的告警）。读入口令时，管道/`--password-stdin` 必须**在一次 `readline`
  会话里读两行**（新口令与确认）：旧的 `readLine` 每次调用都新建一个 interface，
  `printf 'pw1\npw2\n' | node` 时第二行恒为空字符串，主用法会稳定失败；TTY 分支走隐藏回显读
  两次，逻辑抽成可注入函数保持极薄；并补一条 `printf` 型真实子进程集成测试。`user list` 对
  admin 行追加 ` (admin)`；**既有 `user add` / `user disable` 必须改走 `mutateUsersFile`**，
  从而同样获得锁、CAS 与 last-admin 保护。
- **`dsh-auth user totp <enable|disable>`（`src/features/totp/cli.ts`）同样改走 `mutateUsersFile`**：
  mutator 内 **spread 既有 record**、只改 `totpSecret`。此前它直调无锁的 `writeUsersFile`，并在
  写入时手工重建整条记录（不 spread 原 record）：新 schema 落地后跑一次 `totp disable` 会
  **静默抹掉 `role` / `must_change_password` 等字段**，last-admin 不变量也随之失效。
- **CLI 改密与面板改密的语义差异（有意为之）**：`dsh-auth user passwd <name>` 是离线运维
  通道，只改哈希，**不吊销该用户已发的会话**：运行中的服务在下次登录读文件时按新口令校验，
  旧 cookie 仍有效到会话 TTL 到期（需要立刻全踢时用面板自助改密，或走 `user disable` 的周期
  吊销）。对照之下，面板自助改密在写盘成功后吊销该 subject 的全部会话（含当前会话）。另外，
  面板自助改密成功后**清除** `must_change_password` 标记，而 CLI `user passwd` **不清除**
  （该语义留给 P2 的管理员重置流程）。

## 背景

users.yaml 从 M3 起就是口令模式的唯一用户库（scrypt 哈希 + TOTP secret + disabled 标志，
schema 严格、按 `version: 1` 演进）。当时的写入者只有 CLI 一个进程、一次一条命令；现在
P1 新增了一条**常驻服务进程内的写入路径**（自助改密端点，见 D22），于是同一份文件同时有
「插件进程内的请求」与「运维手上的 CLI」两类写者，之前默认成立的「单写者、无并发」前提不再
成立。没有锁的 read-modify-write 会丢更新：CLI 刚加的 TOTP secret 可能被一次并发的端点写盘
覆盖，反之亦然。

口令策略同样到了必须显式化的点：自助改密把「设置什么口令」的权利交回用户手上，如果服务端
只保留 M3 的最小长度校验，那么「改密」很容易变成「把强口令换成 `123456`」。策略因此必须
是一条双方共用、可测试、可机器读取失败项的规则（端点 400 `policy` 的 `rules` 与 CLI 的报错
都得来自同一个实现）。

可行性评估（工作区 `notes/tech/dsh-auth-gate/password-change-feasibility-2026-09-23.md` §3 的
关键点 5 至 11）复核过两件事：一是 `writeUsersFile` 的 tmp→rename 会换 inode，所以锁必须
独立成文件；二是策略的「最贵一步放最后」与「不 trim / 不 NFKC」是既有哈希兼容性的硬约束。
主人于 2026-09-23 16:49 拍板了角色模型、锁方案与分期（§6 第 1、2、4、5 条）。

## 考虑过的替代方案

- **bcrypt / argon2 替换 scrypt** 否：`node:crypto` 的 scrypt 已经满足需求且零依赖，参数随
  哈希存储（D3）让加固成为滚动变更（新哈希用新参数、旧哈希按存储值重派生），换 KDF 会把
  全部存量哈希作废，收益不抵成本。
- **密码历史（禁止复用最近 N 个口令）** 否：需要为每个用户保存历史哈希列表，schema、写盘
  形态与迁移全部要动；本期只保留 `sameAsOld` 这一条零成本规则，历史留待有真实需求时再做。
- **管理员用 boolean `admin: true` 而不是 `role` 枚举** 否：布尔值无法表达第三个角色（如
  只读运维），且语义被塞进字段存在性里（`admin: false` 与缺省无法区分）；枚举是可扩展且
  可校验的形态，`role: "user"` 缺省不落盘也保持了既有文件字节不变。
- **把锁加在 `users.yaml` 本身（例如 flock 同一 fd / 同一路径）** 否：写盘是 tmp→rename，
  rename 之后锁文件指向的 inode 已经不是当前 users.yaml；两个写者会各自锁住不同的 inode 并
  同时写。锁必须是独立的 `users.yaml.lock`。
- **无锁直写（维持现状，靠「写的人不多」）** 否：丢更新是静默数据损坏（用户被莫名降级、
  TOTP secret 消失），且端点上线后并发窗口从「几乎不发生」变成「运维跑 CLI 时随时发生」；
  一次 `wx` 打开加 mtime/size CAS 的成本极低。
- **只加锁、不做写前 CAS** 否：锁只能挡住守规矩的写者（本插件与 CLI），手改 YAML、编辑器
  保存、备份还原都会绕过锁；写前比对 mtime/size 才能发现「锁外有人动过」，不一致就重读重跑，
  超过重试上限就报错而不是覆盖。
- **在 users.yaml 之外引入 SQLite / JSON 库** 否：新增依赖与迁移成本，且用户库的体量（个位数
  到几十个用户）完全不需要数据库；原子写 + 锁 + 备份已经覆盖需要的一致性。
- **强制改密分流（`must_change_password` 本期生效）** 否：会改登录成功路径并新增强制改密页，
  本期只预留字段；管理员重置口令走「重置 + 全踢目标会话 + 审计」（P2）。
- **把角色授予开成 HTTP 端点（`POST /auth/users/role`）** 否：那是在认证插件里新增一条提权
  通道，攻击面与审计需求都要重算；CLI 是离线通道，运维身份由服务器登录本身保证，够用且更小。

## 为什么这样选

两条决策共用一个判据：**让「不该静默发生的事」变成显式的、可测试的、机器可读的失败。**

策略层把所有者可读的失败项收敛成一个枚举（`rules`），端点与 CLI 复用同一个实现，口令规则
将来要调整时只改一处、测试跟着走；`sameAsOld` 通过注入比较器留在 shared 叶子层，同时满足
分层硬规则与「复用生产验证函数」。锁层把并发写入从「大概率没事」变成「要么拿到锁并 CAS
成功，要么抛出面向操作员的 `UsersFileError`」；`.bak` 与原子写保证任何一次写坏都能回滚，
last-admin 不变量把「把自己锁在门外」这种最昂贵的人为事故挡在写盘之前。角色用枚举、只走
CLI，是为了让 P2 的管理面（`GET /auth/users`、`POST /auth/users/password`）能够**只加端点、
不改 schema**，本期的 `must_change_password` 预留字段同理。

范围纪律：P1 只做策略 + 锁 + CLI + 自助端点所需的公共面，不做密码历史、不做强制改密、不做
数据库化、不开 HTTP 提权面。这些都在上面的替代方案里记录了「为什么不现在做」，而不是无声地
留白。
