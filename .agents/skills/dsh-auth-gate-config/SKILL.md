---
name: dsh-auth-gate-config
description: Use when the user asks about dsh-auth-gate configuration - supported options (mode/sessionTtl/cookieName/tokenRef/cookieSecure/usersFile/logoutOrder), how to configure them, the dsh-auth CLI, login trouble, rate limiting, or the logout button. Ships with the dsh-auth-gate package; install with `dsh-auth skill install`.
---

# dsh-auth-gate 配置速查

随 dsh-auth-gate 分发的配置技能：用户/部署者问登录门支持哪些配置、怎么配、CLI 用法、常见故障时使用。

## 触发词

auth-gate / 登录门 / 退出登录按钮 / cookieSecure / usersFile / logoutOrder / mode /
dsh-auth 命令 / 登录不上 / 限速锁定 429 / 配置面 403

## 一句话定位

dsh web 实例的应用层登录门（Cordis 插件，TecFancy/dsh-auth-gate，MIT）。
已部署形态示例：主实例 password 模式 + HTTPS 反代。

## 配置项全表（在 $DSH_HOME/cordis.patch.yml 里按 id 覆盖）

```yaml
- id: dsh-auth-gate
  config:
    mode: "password" # "password"（推荐）或 "token"
    cookieSecure: true # HTTPS 必须 true；纯 http 测试 false（否则浏览器不收 cookie）
    usersFile: "" # 密码模式用户文件；默认 $DSH_HOME/auth/users.yaml
    sessionTtl: 604800 # 会话秒数
    cookieName: dsh_auth # 会话 cookie 名
    tokenRef: DSH_AUTH_TOKEN # token 模式的凭证引用（环境变量名）
    logoutOrder: 1000 # 退出按钮在 设置→通用设置 槽位顺序（越大越靠底）
```

- 配置覆盖**不带 insert**（bundle 已挂载行，加了会二次挂载）。
- 改为 token 模式时不用建用户文件，把共享秘密放进 `.credentials.yaml`（`DSH_AUTH_TOKEN`）。
- users.yaml / .credentials.yaml 均 0600。

## CLI（`dsh-auth`）

```sh
# profile 内安装的 CLI 不在 PATH，走 pnpm 转发：
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user add admin --password-stdin
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user list
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth user disable <name>
# 技能安装（本包内置的配置速查，装进 $DSH_HOME/skills/ 供 dsh agent 加载）：
pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>" exec dsh-auth skill install [--force]
```

- 指定用户文件（多实例隔离）：`--file <path>`。
- 禁用只挡新登录，已登录会话等过期。

## 常见问题速查

| 现象                                                    | 原因/处理                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `dsh-auth: command not found`                           | 插件装在 profile 内，CLI 不在 PATH → 用 pnpm 转发                                                                             |
| 设置→模型页「settings are unavailable in this browser」 | 远程浏览器 origin 非 loopback，配置面被 fence 挡 → 用 `dsh-auth-proxy --listen 127.0.0.1:8443 --target <https 地址>` 本地代理 |
| 连续输错被锁 429                                        | 限速：5 次失败锁 30s（重启清零）；`retry-after` 头部有提示                                                                    |
| 登录页能开但登录 401                                    | password 模式查 users.yaml（路径/权限）；CLI add 与插件读同一个文件                                                           |
| 退出按钮不在通用设置最底部                              | 其他插件注册了更大 order/priority 的条目 → `logoutOrder` 调大                                                                 |
| 改动配置不生效                                          | 改了 `$DSH_HOME/cordis.patch.yml` 后重启 dsh；`dsh --profile <p> --dump-config` 查组合结果                                    |

## 验证技巧（隔离测试实例上）

- 登录页：GET /auth/login → 200 含 username/password 表单；API 未认证一律 401、HTML 302 到登录页。
- `curl http://127.0.0.1:<port>/auth/status` → `{"authenticated":false,"logoutOrder":1000}`（status 只认 cookie，Bearer 不参与）。
- 登录后设置 → 通用设置：`[data-slot="settings.general.item"]` 的最后一个子元素应是「退出登录」（form POST /auth/logout?next=/）。
- logoutOrder 生效验证：patch 配 5200 → status 返回 5200，按钮仍在最后。
- 多实例隔离：CLI `--file` 指定独立 users.yaml，避免共享 `$DSH_HOME/auth/users.yaml`。

## 关键文件位置

- 源码仓库：TecFancy/dsh-auth-gate（README 配置表、docs/deployment.md 部署清单、docs/dsh-auth-plan.md 路线图）。
- 本技能随包分发：`<包根>/.agents/skills/dsh-auth-gate-config/`；安装目标 `$DSH_HOME/skills/dsh-auth-gate-config/`，
  与主工作区 `.dsh/skills/dsh-auth-gate-config/` 同源（改一处同步另一处）。
