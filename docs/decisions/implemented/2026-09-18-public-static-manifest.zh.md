# D13. PWA manifest 列入免守卫公开静态路径

## 决定了什么

`src/gate/guard.ts` 新增常量 `PUBLIC_STATIC_PATHS = ["/manifest.webmanifest"]` 与判定
`isPublicStaticPath(kind, pathname)`（**精确匹配**；`kind === "upgrade"` 恒 false）。
`TokenGate` 与 `PasswordGate` 在 `/auth` 白名单判定之后、查凭证之前各加一行
`if (isPublicStaticPath(kind, pathname)) return "allow";`。`/auth` 与 `/auth/*` 的
既有表达式、以及其余入口的认证语义一行未动。

## 背景

线上（`dsh.hi-ruofei.com`，dsh 0.1.5-rc.2 + Caddy + 门）登录后浏览器控制台常驻
报错：`GET /manifest.webmanifest → 401`。这不是漏配：

- 浏览器抓取 Web App Manifest 时**按规范不带凭证**。Chromium
  `blink/renderer/modules/manifest/manifest_fetcher.cc`：
  `SetCredentialsMode(use_credentials ? kInclude : kOmit)`，而
  `manifest_manager.cc: ManifestUseCredentials()` 只在 `<link rel="manifest"
crossorigin="use-credentials">` 时为 true。线上产物
  `dsh-web-frontend/dist/index.html` 的 manifest `<link>` **没有** `crossorigin`，
  所以必然 `omit`——cookie 门永远认不出这次请求。
- 门的白名单只有 `/auth` 前缀（M4/P12），fallback 席位（`dsh-host-frontend-static`）
  整片被守卫包住，manifest 文件虽在 dist 里、`.webmanifest` 的 MIME 也已映射，
  仍被拒成 401。
- 仓库自己的入口矩阵漏了这一行：`docs/deployed/entry-coverage-0.1.5-rc.2*.md`
  只补了 `/`、`/index.html`、`/favicon.ico`。同类的 `/favicon.ico` 401 是设计内、
  无害（文档请求的 favicon 带 cookie，登录后即有）；manifest 是**功能性**失效：
  PWA 安装、`display: fullscreen`、图标元数据全废，且影响所有部署该门的用户。

## 考虑过的替代方案

- **Caddy 侧直答或 `file_server` 托管该文件** —— 当天见效，但内容与 dist 双份、
  路径带 `dsh-015rc2` 这类版本号，下次 dsh 升级就腐化；而且只修一台部署，
  其他用门的人照旧 401。
- **改 dist 的 `<link>` 加 `crossorigin="use-credentials"`** —— 语义最正，
  但改的是 dsh 官方产物，宿主升级即被覆盖（本机也没有 dist patch 机制）；
  门不能把正确性寄托在宿主将来这么写。
- **白名单放整个静态前缀（`/assets`、`/favicon.ico` 等）** —— 立刻把整个前端包
  变成公开面，且违背「未认证不得拿到任何应用字节」的现有口径；favicon 实测带
  cookie，本来就不需要放行。
- **加配置项 `publicPaths: string[]`** —— 违背 M4/P12「不做独立白名单配置项」的
  冻结决策，把安全边界下放给使用者，默认值还得写死一次，收益不过是可改。
- **什么都不做** —— 接受常驻 401 与 PWA 能力失效。

## 为什么这样选

一条精确路径是「不认证也必须可达」的**最小**公开面：manifest 只含 `name` /
`short_name` / `start_url` / `display` / 图标引用，不含任何工作区、会话或路径信息，
与 `/auth`（登录页必须可达）同属一类豁免。精确匹配（不加前缀、不容尾斜杠）与
`upgrade` 排除让攻击面只多一个只读 GET；常量放 `guard.ts`、两个门共用同一个判定，
白名单漂移只有一处。

遗留：PWA **安装**流程里浏览器还会去抓 manifest 声明的图标（`/favicon.svg`），
那条抓取是否同样 omit 未经验证（自动化浏览器对 manifest/图标抓取是惰性的，本机
复现不了）。真要做 PWA 安装时再按同样方法取证、必要时再放一条精确路径，不要预先
扩大白名单。
