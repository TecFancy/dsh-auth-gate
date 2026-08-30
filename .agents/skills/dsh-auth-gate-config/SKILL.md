---
name: dsh-auth-gate-config
description: Use when the user asks about dsh-auth-gate configuration - supported options (mode/totp/sessionTtl/cookieName/tokenRef/cookieSecure/usersFile/logoutOrder), how to configure them, the dsh-auth CLI (incl. user totp enable/disable), login trouble, rate limiting, or the logout button. Ships with the dsh-auth-gate package; install with `dsh-auth skill install`. / 用户询问 dsh-auth-gate 配置（mode/totp/sessionTtl/cookieName/tokenRef/cookieSecure/usersFile/logoutOrder）、dsh-auth CLI（含 user totp enable/disable）、登录故障、限速或退出按钮时使用。随 dsh-auth-gate 包发布；用 `dsh-auth skill install` 安装。
# 低频查询技能：不让模型自动发现/调用（避免常驻技能目录稀释注意力），
# 用户显式打开技能面板调用（user-invocable 默认 true，UI 显示 "user-only"）。
disable-model-invocation: true
---

# dsh-auth-gate Configuration Quick Reference / dsh-auth-gate 配置速查

Configuration skill shipped with dsh-auth-gate: use when a user or deployer asks
which options the login door supports, how to configure them, CLI usage, or how
to fix common failures.
随 dsh-auth-gate 分发的配置技能：用户/部署者问登录门支持哪些配置、怎么配、
CLI 用法、常见故障时使用。

## Triggers / 触发词

auth-gate / login door / logout button / cookieSecure / usersFile / logoutOrder /
mode / totp / two-factor / authenticator code / dsh-auth commands / login failures / rate-limit 429 / config 403
auth-gate / 登录门 / 退出登录按钮 / cookieSecure / usersFile / logoutOrder / mode /
totp / 两步验证 / 验证码 / dsh-auth 命令 / 登录不上 / 限速锁定 429 / 配置面 403

## What it is / 一句话定位

Application-layer login door for a dsh web instance (Cordis plugin,
TecFancy/dsh-auth-gate, MIT). Typical deployed shape: main instance in password
mode behind an HTTPS reverse proxy.
dsh web 实例的应用层登录门（Cordis 插件，TecFancy/dsh-auth-gate，MIT）。
已部署形态示例：主实例 password 模式 + HTTPS 反代。

## Configuration options / 配置项全表

Override by `id` in `$DSH_HOME/cordis.patch.yml`:
在 `$DSH_HOME/cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-auth-gate
  config:
    mode: "password" # "password"（推荐）or "token" / "password"（推荐）或 "token"
    totp: "optional" # "off"(default) | "optional" | "required" - two-factor for password mode / 密码模式两步验证："off"（默认，忽略密钥）| "optional"（有密钥的用户两段式）| "required"（全员必须）
    cookieSecure: true # HTTPS requires true; plain-http testing false (browser rejects cookie) / HTTPS 必须 true；纯 http 测试 false（否则浏览器不收 cookie）
    usersFile: "" # password-mode user file; default $DSH_HOME/auth/users.yaml / 密码模式用户文件；默认 $DSH_HOME/auth/users.yaml
    sessionTtl: 604800 # session TTL in seconds / 会话秒数
    cookieName: dsh_auth # session cookie name / 会话 cookie 名
    tokenRef: DSH_AUTH_TOKEN # token-mode credential reference (env var name) / token 模式的凭证引用（环境变量名）
    logoutOrder: 1000 # logout button slot order in Settings > General (larger = further down) / 退出按钮在 设置→通用设置 槽位顺序（越大越靠底）
```

- Override **without** `insert` — the bundle row is already mounted; adding one
  double-mounts. / 配置覆盖**不带 insert**（bundle 已挂载行，加了会二次挂载）。
- Token mode needs no user file; put the shared secret in `.credentials.yaml`
  (`DSH_AUTH_TOKEN`). / 改为 token 模式时不用建用户文件，把共享秘密放进
  `.credentials.yaml`（`DSH_AUTH_TOKEN`）。
- `users.yaml` / `.credentials.yaml` must be `0600`. / 均 0600。

## CLI (`dsh-auth`)

```sh
# CLI installed inside a profile is not on PATH; forward through pnpm:
# profile 内安装的 CLI 不在 PATH，走 pnpm 转发：
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user add admin --password-stdin
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user list
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user disable <name>
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user totp enable <name> # prints base32 secret + otpauth:// URI / 生成 TOTP 密钥（打印 base32 与 otpauth:// URI）
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user totp disable <name>
# Install this quick-reference skill into $DSH_HOME/skills/ for the dsh agent:
# 技能安装（本包内置的配置速查，装进 $DSH_HOME/skills/ 供 dsh agent 加载）：
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth skill install [--force]
```

- Pick a per-instance user file with `--file <path>` (multi-instance isolation). /
  指定用户文件（多实例隔离）：`--file <path>`。
- Disable only blocks new logins; existing sessions expire naturally. /
  禁用只挡新登录，已登录会话等过期。

## Common failures / 常见问题速查

| Symptom / 现象                                                | Cause / fix / 原因/处理                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsh-auth: command not found`                                 | CLI lives inside the profile, not on PATH - forward through pnpm. / 插件装在 profile 内，CLI 不在 PATH → 用 pnpm 转发                                                                                                                                                                                                                                                                                                                                 |
| Settings > Models: "settings are unavailable in this browser" | Remote browser origin is not loopback, the config surface is fenced - use `dsh-auth-proxy --listen 127.0.0.1:8443 --target <https url>`. / 远程浏览器 origin 非 loopback，配置面被 fence 挡 → 用 `dsh-auth-proxy` 本地代理                                                                                                                                                                                                                            |
| Repeated failures locked with 429                             | Rate limit: 5 failures locks for 30s (resets on restart); `retry-after` header tells you. / 限速：5 次失败锁 30s（重启清零）；`retry-after` 头部有提示                                                                                                                                                                                                                                                                                                |
| Login page renders but login returns 401                      | Password mode reads `users.yaml` (path/permissions); the CLI and the plugin read the same file. / password 模式查 users.yaml（路径/权限）；CLI add 与插件读同一个文件                                                                                                                                                                                                                                                                                 |
| Test instance overridden by main instance                     | `$DSH_HOME/cordis.patch.yml` is a **global user layer applied to every profile** and overrides a profile's own patch (e.g. the main instance sets `cookieSecure: true`, killing plain-http test logins). Fix per boot: `dsh --profile <p> --patch <file> ...`. / `$DSH_HOME/cordis.patch.yml` 是**全 profile 共享层**，会覆盖 profile 自己的 patch（例：主实例 cookieSecure:true 覆盖测试实例 false → http 登录全挂）→ 启动时加 `--patch <file>` 覆盖 |
| `--patch` override resets other options                       | The `--patch` layer **replaces the whole config object** at the id level (not a deep merge) - put the full config in the patch file. / `--patch` 层对 config 是**整对象替换**（按 id 合并，非深合并）→ patch 文件里写全量 config                                                                                                                                                                                                                      |
| Logout button not at the bottom of General settings           | Another plugin registered a larger order/priority - raise `logoutOrder`. / 其他插件注册了更大 order/priority 的条目 → `logoutOrder` 调大                                                                                                                                                                                                                                                                                                              |
| Config changes have no effect                                 | Restart dsh after editing `$DSH_HOME/cordis.patch.yml`; `dsh --profile <p> --dump-config` shows the composed result. / 改了 `$DSH_HOME/cordis.patch.yml` 后重启 dsh；`dsh --profile <p> --dump-config` 查组合结果                                                                                                                                                                                                                                     |
| Code page spins / after submit back to password page          | TOTP challenge expires after 5 min; since 0.11.1 the cookie is HMAC-signed with a process key - restart/reload also invalidates it, re-enter the password. / 验证码挑战最长 5 分钟；0.11.1 起 cookie 带进程级 HMAC 签名——重启/重载插件同样使挑战失效，需重新输密码                                                                                                                                                                                    |
| Same code rejected on second submit                           | Replay guard (in-memory, keyed by time window, resets on restart) - independent of rate limiting. / 同一时间窗口的验证码第二次提交被防重放拒绝（内存态，重启清零），与限速相互独立                                                                                                                                                                                                                                                                    |

## Verification tips / 验证技巧

Run on an isolated test instance. / 隔离测试实例上验证：

- Login page: `GET /auth/login` → 200 with a username/password form; unauthenticated
  API calls always get 401, HTML requests get 302 to login. / 登录页：
  GET /auth/login → 200 含 username/password 表单；API 未认证一律 401、HTML 302 到登录页。
- `curl http://127.0.0.1:<port>/auth/status` → `{"authenticated":false,"logoutOrder":1000}`
  (status only accepts cookies; Bearer does not participate). / `curl .../auth/status`
  返回该 JSON（status 只认 cookie，Bearer 不参与）。
- After login, Settings > General: the last child of
  `[data-slot="settings.general.item"]` should be "Sign out" (form POST
  `/auth/logout?next=/`). / 登录后设置 → 通用设置：`[data-slot="settings.general.item"]`
  的最后一个子元素应是「退出登录」（form POST /auth/logout?next=/）。
- `logoutOrder` check: patch it to 5200 → status returns 5200 and the button stays
  last. / logoutOrder 生效验证：patch 配 5200 → status 返回 5200，按钮仍在最后。
- TOTP second step: after a correct password the login page switches to a "Verify"

  page (6-digit code input); the challenge lasts ≤5 min and rides the session

  cookie. / TOTP 第二步：密码正确后登录页切到 "Verify" 页（6 位验证码）；

  挑战态最长 5 分钟、随会话 cookie 携带。

- Multi-instance isolation: give each instance its own users.yaml via `--file`,
  avoiding the shared `$DSH_HOME/auth/users.yaml`. / 多实例隔离：CLI `--file` 指定
  独立 users.yaml，避免共享 `$DSH_HOME/auth/users.yaml`。

## Key file locations / 关键文件位置

- Source repo: TecFancy/dsh-auth-gate (README config table, docs/deployment.md,
  docs/dsh-auth-plan.md). / 源码仓库：TecFancy/dsh-auth-gate（README 配置表、
  docs/deployment.md 部署清单、docs/dsh-auth-plan.md 路线图）。
- This skill ships inside the package: `<package root>/.agents/skills/dsh-auth-gate-config/`,
  installed to `$DSH_HOME/skills/dsh-auth-gate-config/`, kept in sync with the main
  workspace copy `.dsh/skills/dsh-auth-gate-config/` (edit one, sync the other). /
  本技能随包分发：`<包根>/.agents/skills/dsh-auth-gate-config/`；安装目标
  `$DSH_HOME/skills/dsh-auth-gate-config/`，与主工作区 `.dsh/skills/dsh-auth-gate-config/`
  同源（改一处同步另一处）。
