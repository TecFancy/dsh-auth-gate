# Agent Note: Configurable logout CTA order

Status: implemented
Legacy ID: D4

[English](2026-08-30-configurable-logout-order.md) | 中文

## Problem

dsh 自带设置条目落在 -25..20 的 order 区间，多数第三方插件在 1000 以下。硬编码 order 可能与注册更大 order 的插件冲突，把退出按钮顶到意外位置。v0.10.0 在设置面工作完全冻结前发布了这个能力。

## Decision

设置 → 通用设置 页退出按钮的槽位 order 通过 `logoutOrder` 配置（natural，max 10000，默认 1000），经 `GET /auth/status` 透传给 client 半边。

## Alternatives considered

- **固定常量**——拒绝：无法适配注册更大 order 的宿主插件。
- **运行时自动探测最大已注册 order**——拒绝：运行时探测槽位脆弱，还会制造排序反馈环。

## Why

显式配置旋钮比探测更简单可预期；默认 1000 已高于所有已知条目，真需要时每部署一行配置即可调大。

回填注记：本记录在决策记录制度落地时（2026-08-30）登记；变更本身随 v0.10.0 发布。
