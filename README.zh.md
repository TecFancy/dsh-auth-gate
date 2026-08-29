# dsh-auth-gate

[English](README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![npm downloads](https://img.shields.io/npm/dt/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![npm monthly downloads](https://img.shields.io/npm/dm/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![node](https://img.shields.io/node/v/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![types](https://img.shields.io/npm/types/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![CI](https://github.com/TecFancy/dsh-auth-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/TecFancy/dsh-auth-gate/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-auth-gate.svg)](LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）网页版加一道登录门。部署到
公网 dsh 实例前面之后，不登录就没人能碰到你的 agent、聊天会话和 LLM 凭证。

## 它能做什么

- **所有访问都要先登录。** 每个页面、每个 API 调用、每条 WebSocket 连接都会检查；
  没有有效会话的访客会被带到简单的登录页（API/脚本请求则返回 `401`）。
- **两种登录方式**（配置里二选一）：
  - **密码**（推荐）：每个管理员一个用户名和密码。
  - **令牌**：整个实例共用一个秘密令牌。
- **浏览器和脚本都能用。** 浏览器走登录页；脚本和 curl 直接带
  `Authorization: Bearer <token>` 就能跳过登录页。
- **默认就安全。** 密码只存哈希、登录有限速（反复输错会临时锁定该地址）、会话 cookie
  带安全属性，而且配置缺失或损坏时**拒绝访问而不是悄悄开门**。
- **一个管理用户的小命令行工具**：

  ```sh
  dsh-auth user add admin --password-stdin   # 添加用户
  dsh-auth user list                          # 查看用户
  dsh-auth user disable admin                 # 禁止某用户今后登录
  ```

  全局安装时 `dsh-auth` 直接在你的 PATH 上；`dsh plugin add` 安装后二进制在
  profile 里，需要经由 profile 调用——见[快速开始](#快速开始)。

## 快速开始

```sh
# 1. 从 npm 装进你的 dsh profile。
#    0.4.1 起包声明了 dsh.bundle manifest，`dsh plugin add` 会同时自动注册挂载
#    （dsh.profile.bundles），无需手动写挂载行：
dsh plugin --profile web add dsh-auth-gate

# 2. 创建管理员账号。
#    `dsh plugin add` 把插件装进 profile 的 node_modules
#    （$DSH_HOME/profiles/web，默认 ~/.dsh/...），CLI **不会**进你的 PATH，
#    所以要经由 profile 调用。`dsh plugin` 本来就要求有 pnpm：
printf '%s\n' '选一个强密码' | \
  pnpm --dir "$DSH_HOME/profiles/web" exec dsh-auth user add admin --password-stdin

# 3. 开启密码登录：在 $DSH_HOME/cordis.patch.yml 里覆盖插件配置
#    （仓库自带现成配置覆盖模板 deploy/cordis.patch.yml，见下方"配置"——挂载本身
#    不需要手动 patch 行）

# 4. 重启 dsh，打开你的站点——会先要求登录。
```

## 效果预览

未登录的访客会被带到登录页：

![登录页](docs/demo/login-page.png)

登录后进入你的实例：

![dsh 实例](docs/demo/dashboard.png)

设置面板里有一个醒目的**「退出登录 / Sign out」**按钮——在 **设置 → 通用设置**
页的最下方（最后一条设置项之后）。它是居中排布的填充式危险按钮（16px 门形图标 +
本地化文字，配色用主题 token、深浅色自适应）；文案跟随界面语言（复用「设置」里
语言切换的同一套 locale 机制）；点击走原有的原生 `POST /auth/logout?next=/` 登出流程。

## 配置

bundle 挂载行（id `dsh-auth-gate`，由 `dsh plugin add` 自动插入）使用默认配置：
`mode: "token"`，由 `DSH_AUTH_TOKEN` 环境变量提供共享秘密。要改配置，在
`$DSH_HOME/cordis.patch.yml`（或 profile 的 `cordis.patch.yml`）里按 id 覆盖——
仓库自带现成覆盖模板 `deploy/cordis.patch.yml`。注意：覆盖条目**不要带 `insert`**
（否则会二次挂载插件），只覆盖 config：

```yaml
- id: dsh-auth-gate
  config:
    mode: "password" # "password"（推荐）或 "token"
    cookieSecure: true # 使用 https 时保持 true
```

| 选项           | 默认值             | 作用                                                                                                      |
| -------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| `mode`         | `"token"`          | `"password"` = 用户名密码登录；`"token"` = 一个共享秘密                                                   |
| `sessionTtl`   | `604800`           | 一次登录持续多久（秒），到期需重新登录                                                                    |
| `cookieName`   | `dsh_auth`         | 会话 cookie 的名字（很少需要改）                                                                          |
| `tokenRef`     | `"DSH_AUTH_TOKEN"` | 仅令牌模式：共享秘密存在哪个环境变量里                                                                    |
| `cookieSecure` | `true`             | 只在纯 http 测试环境设为 `false`                                                                          |
| `usersFile`    | `""`               | 密码模式：用户列表文件位置。默认 `$DSH_HOME/auth/users.yaml`                                              |
| `logoutOrder`  | `1000`             | 「退出登录」按钮在 设置 → 通用设置 页的槽位顺序（越大越靠底）。若有其他插件注册了更大的 order，可调大此值 |

## 故障排查

### `dsh-auth: command not found`

`dsh plugin --profile web add dsh-auth-gate` 把包装进 profile 的 `node_modules`
（`$DSH_HOME/profiles/web/node_modules/dsh-auth-gate`，默认 `~/.dsh/...`），
但不会往你的 shell `PATH` 里加任何东西，所以 CLI 二进制不能直接用名字调用。
这只影响 CLI——插件本身运行正常。任选其一：

1. **经由 profile 调用（推荐）。** `dsh plugin` 本来就要求有 pnpm，让 CLI
   从插件所在的同一位置解析：

   ```sh
   pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec dsh-auth user add admin --password-stdin
   pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec dsh-auth user list
   ```

   可选，每个 shell 会话加一次：

   ```sh
   alias dsh-auth='pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec dsh-auth'
   ```

2. **直接用 node 调用**（运行时不依赖 pnpm）：

   ```sh
   node "$DSH_HOME/profiles/web/node_modules/dsh-auth-gate/lib/cli.js" user add admin --password-stdin
   ```

3. **全局安装**，`dsh-auth` 就会在你的 PATH 上：

   ```sh
   npm install -g dsh-auth-gate
   dsh-auth user add admin --password-stdin
   ```

无论哪种调用方式，CLI 读写的是同一份共享用户列表
（`$DSH_HOME/auth/users.yaml`，兜底 `~/.dsh/auth/users.yaml`，即插件读取的
那份）——全局安装的包只是启动器。

## 部署

- [反代部署指南](docs/reverse-proxy_zh.md) —— Caddy/nginx 配置、浏览器信任栅栏的坑
  （反代后设置页 `403`，以及为什么只加认证修不了它）、推荐的半外壳拓扑。
- [docs/deployment_zh.md](docs/deployment_zh.md) —— 运维清单、验收步骤（A–I）与故障诊断。

## 认证本地代理（可选，dsh-auth-proxy)

> 半外壳解决服务端 `/api` 栅栏后，dsh **客户端**还要求"页面 origin 必须回环"：域名页面下
> 设置页报 "settings are unavailable in this browser"（与认证无关）。`dsh-auth-proxy`
> 在用户本机提供回环页面入口，配合 auth-gate 实现"远程编辑配置 + 全程认证"，
> 不修改 dsh 源码。详细设计见 [docs/local-proxy_zh.md](docs/local-proxy_zh.md)。

- 零依赖 Node bin（`dsh-auth-proxy`）：严格绑定 `127.0.0.1`、无状态透传页面/API、
  `events.mux`/`events.host` WebSocket 隧道、`Set-Cookie` 去 `Secure` 适配（Safari 兜底）。
- 认证复用 auth-gate（密码/令牌模式均可）：登录页与会话 cookie 原样透传。
- **安全边界（deny-list，Phase 2.1）**：配合 `--mark-proxy`，服务端 guard 对标记请求中的
  `host.pickDirectory`/`host.openPath`/`settings.openDocument`/`llm.discoverModels` 返回 403，
  防止远程认证用户触发宿主原生能力；未开启标记时行为与未部署代理完全一致。

```sh
dsh-auth-proxy --listen 127.0.0.1:8443 --target https://your-domain.example --mark-proxy
# 浏览器打开 http://127.0.0.1:8443 → 登录 →「设置 → 模型」即可编辑
```

systemd 示例：`deploy/systemd/dsh-auth-proxy.service.example`。

## 环境要求

- 服务器上需要 Node ≥ 22.19 和 pnpm。
- dsh 的 `web` profile 正常运行（`dsh --profile web`）。
- 如果 `cookieSecure` 是 `true`，站点必须走 https（浏览器在纯 http 下会拒绝安全 cookie）。

## 许可证

[MIT](./LICENSE)

## 注意事项与局限

- 禁用用户只阻止**新**登录；已经登录的会话要等它自然过期。
- 登录限速在服务器重启后清零。
- 反代部署时，限速按反代出口地址统计。
- 设置面板里有「退出登录」按钮：在 设置 → 通用设置 页最下方，文案随语言在
  「退出登录」/ "Sign out" 间切换；`/auth/logout?next=/` 始终可作为兜底。
- 本插件只保护 dsh 的网页入口，不能替代服务器层面的安全：请保持服务器系统用户最小权限、
  配置文件私密（`.credentials.yaml` 和 `auth/users.yaml` 创建时即为 `0600` 权限）。
