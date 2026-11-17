# Agent Note: Market card screenshots are declared by a repository-root `screenshots.json`, behind a gate

Status: implemented
Legacy ID: D36

[English](2026-11-16-market-card-screenshots.md) | 中文

## Problem

插件市场（dsh-market）的卡片缩略图只读目录里的 `screenshots` 字段，而该字段由
awesome-dsh-plugin 每晚跑 `probe-screenshots.mjs` 时，从**插件仓库根目录的 `screenshots.json`**
解析相对路径得到。仓库没有这个文件，目录里就没有字段，`CardShot` 拿到空数组直接 `return null`，
卡片上一张图都不画。

README 里的图确实会被市场读取，但只作为**安装确认弹窗**（`ScreenshotStrip`）的兜底；
插件装好之后按钮变成「✓ 已安装」，弹窗打不开，这条兜底路径也就永远走不到。
所以「README 有 9 张图、市场卡片空白」不是 bug，是两条不同的取图路径。

这个文件没有任何其他引用者：`docs/demo/` 里的图改名时，`readme:parity` 会拦住 README 的引用，
而 `screenshots.json` 会静默指向 404。上游 registry 的文档记着这个代价：773 张已发布截图里
有 41 张就是这样烂掉的，之后才加了探测。

## Decision

在仓库根放 `screenshots.json`，列出 6 张 `docs/demo/` 下的横图，作为插件市场卡片缩略图的唯一来源；
同时新增 `npm run screenshots:check`（`scripts/verify-screenshots.mjs`），把它接进 `verify` 链、
`run-gates.mjs` 的 hygiene 场景和 CI 的 hygiene job。

门禁按上游 registry 的契约校验：1 到 8 张、相对路径不出仓库（不以 `/` 开头、不含 `..`）、
只收 PNG/JPEG/WebP（SVG 会被市场客户端丢弃）、每张文件必须存在、不许重复。

## Alternatives considered

- **只依赖 README 自动抽取** - 卡片不生效：抽取结果只进安装弹窗，已安装的插件看不到。
- **往 awesome-dsh-plugin 的 `data/screenshots.json` 加 key** - 上游 `contributing.md` 明确要求
  不要再往那个文件加新 key，它是给旧条目的回退，有删除计划；而且写死的绝对 URL 改名后只会静默失效。
- **把图放进 npm 包的 `files`** - registry 读的是 GitHub HEAD，不是 npm 包，改了也不生效。
- **不写门禁，只加 JSON** - 就是上面那 41 张 404 的成因；这个文件在仓库里没有第二个引用者，
  没有任何检查会替它发现失效。

## Why

截图放在自己的仓库里，改图推自己的仓库即可，下一次 nightly 构建自动生效，不用提 PR、不用等维护者；
相对路径在仓库内改名会立刻被门禁发现，而不是在别人的页面上烂成 404。
门禁的规则逐条对齐上游契约，所以本地通过就等于 registry 会接受，不会出现「本地绿、上游拒」。
