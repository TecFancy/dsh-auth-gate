# 反代部署指南

给**公网** dsh web 实例部署 dsh-auth-gate 必然经过反向代理（TLS 终结）。本文沉淀
2026-08-15 生产环境的实测经验：可用的 Caddy 配置、设置页 `403` 背后的浏览器信任栅栏
坑、以及推荐的「半外壳」拓扑。

> 配套文档：`docs/deployed/deployment_zh.md`（中文运维清单与验收步骤）、`docs/specs/dsh-auth-plan_zh.md` §9
> M5（规划中的独立外壳）。

## 1. 为什么必须走反代

- dsh CLI **有意拒绝 `--host 0.0.0.0`**——web 应用设计上就要求挂在反代后面跑 loopback
  （`dsh web --host 127.0.0.1 --port 3080`）。
- `cookieSecure: true`（默认）依赖 HTTPS，TLS 由反代终结。
- dsh 进程用低权限 OS 用户运行（纵深防御）。

## 2. 浏览器信任栅栏的坑（先读这段）

dsh 0.1.0-rc.6 的 `/api` 有浏览器信任栅栏（防 DNS rebinding + CSRF）。其中一部分方法
**硬编码为仅 loopback 可调**——`settings.*`、`credentials.*`、`llm.discoverModels`
（`dsh-client-connection` 的 `PRIVILEGED_METHODS`），`--trusted-host` 也放不开。任何反代
部署下，浏览器携带的 `Host: 你的域名` 过不了检查，于是设置页出现 `403` +
`transport failure for /api/settings.describe`——即使 dsh-auth-gate 登录完全正常。
**这不是 dsh-auth-gate 的 bug**：移除门卫裸奔也无效（2026-08-15 实测）。

实测 header 矩阵（登录后访问 `/api/settings.describe`）：

| 上游 `Host` 头                  | `Origin`      | 结果 |
| ------------------------------- | ------------- | ---- |
| `dsh.hi-ruofei.com`（原样透传） | 任意          | 403  |
| `127.0.0.1:3080`（重写）        | 匹配 loopback | 200  |
| `127.0.0.1:3080`（重写）        | 剥离          | 200  |
| `127.0.0.1:3080`（重写）        | 不匹配        | 403  |

**结论**：让 dsh 以为自己在 loopback 的层，必须和做认证的层是同一层。只加认证（无论门卫
在不在）永远修不了 403。

## 3. 拓扑选项

| 选项                       | 认证                         | Host/Origin 重写     | 设置页             | 说明                                               |
| -------------------------- | ---------------------------- | -------------------- | ------------------ | -------------------------------------------------- |
| 普通反代（Caddy 原样透传） | dsh-auth-gate                | 否                   | privileged API 403 | 除设置页外都正常                                   |
| **半外壳（推荐）**         | dsh-auth-gate                | **是**（Caddy 两行） | **全功能**         | 登录页/限速/吊销全保留                             |
| 独立外壳（M5，路线图）     | dsh-auth-gate 自身做代理进程 | 内置                 | 全功能             | dsh 零插件；见 `docs/specs/dsh-auth-plan_zh.md` §9 |

重写架空栅栏由门卫补偿：会话 cookie 为 `SameSite=Lax`，跨站/DNS rebinding 请求拿不到
cookie → 门卫 401。纵深防御从「栅栏 + 门卫」变为「门卫 + SameSite」。

## 4. 配置示例

### 4.1 Caddy —— 普通反代（设置页 privileged API 会 403）

```
dsh.hi-ruofei.com {
	reverse_proxy 127.0.0.1:3080
}
```

### 4.2 Caddy —— 半外壳（推荐：重写 Host + 剥离 Origin）

```
dsh.hi-ruofei.com {
	reverse_proxy 127.0.0.1:3080 {
		header_up Host 127.0.0.1:3080   # dsh 看到 loopback Host
		header_up -Origin                # 剥掉 Origin，栅栏匹配通过
	}
}
```

重载：`sudo systemctl reload caddy`。WebSocket 升级走同一套规则（实测：带 cookie 101、
无 cookie 401）。

### 4.2.1 附注：launch-token 门（dsh ≥ 0.1.2-alpha）与 dsh-auth-gate 自动桥

0.1.2-alpha 起 dsh web 有页面级 launch-token 门：新浏览器需先访问 `/?token=<launchToken>`
才会 mint 30 天有效、绑定 Host authority 的 cookie。dsh-auth-gate 在登录成功后**相对**
跳转 `/?token=…` 自动过门（详见 `docs/implemented/impl-launch-token-bridge_zh.md`）。

- **相对跳转在两种拓扑下都成立**（普通透传 / 半外壳）：浏览器停留在你的域名，
  mint 的 cookie 按实际（可能被重写后的）请求 Host 绑定，后续校验一致。
- **绝不要在这里配绝对 `http://127.0.0.1:3080/…` 跳转**——半外壳重写会把用户浏览器
  送去本机或失败；桥的实现刻意丢弃 `authenticatedUrl` 返回的 host/scheme，只保留 token。
- launch token 会出现在 302 Location 进而进 access log；建议在反代日志侧对 `token=`
  做 redact（Caddy `log_skip` / 过滤器）作为运营卫生。

### 4.3 nginx 等价写法

```nginx
server {
    listen 443 ssl;
    server_name dsh.hi-ruofei.com;
    # ... ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host 127.0.0.1:3080;   # loopback Host
        proxy_set_header Origin "";             # 清空 Origin（空值即移除）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; # WebSocket
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

## 5. 快速验证

```sh
# 未认证：页面导航 302 到 /auth/login，API 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: text/html" https://dsh.hi-ruofei.com/__dsh_api   # 302
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: application/json" https://dsh.hi-ruofei.com/__dsh_api  # 401
# 登录后（cookie jar）：
#   settings.describe / credentials.describe → 200（半外壳）
#   /api/events.host WebSocket 升级 → 带 cookie 101，无 cookie 401
```

完整验收清单：`docs/deployed/deployment_zh.md` §4（A–I）。

## 6. 故障诊断

| 症状                                    | 原因                                    | 处理                             |
| --------------------------------------- | --------------------------------------- | -------------------------------- |
| 设置页 `transport failure ... HTTP 403` | 栅栏 loopback 钉死；反代透传了公网 Host | 半外壳重写（§4.2）               |
| 登录后 `/api` 全 401                    | 会话失效（服务重启；会话为内存态）      | 重新登录                         |
| 登录 `429`                              | 限速锁定（按反代出口 IP 聚合）          | 等 `retry-after`，或重启 dsh-web |
| 浏览器存不住会话                        | `cookieSecure: true` 但没有 https       | 反代终结 TLS                     |
| 无 cookie 的 WS `401`                   | 门卫拒升级                              | 预期 fail-closed；先登录         |

## 7. 安全注意

- 公网**不要**裸奔运行 dsh：agent 有工作区写权限，`$DSH_HOME/.credentials.yaml` 里有你的
  模型 API key（任何人都能白嫖你的额度）。
- dsh-web 重启会清空内存会话——所有浏览器需重新登录。
- 限速按反代出口 IP 聚合（不要信任 `X-Forwarded-For`）。
