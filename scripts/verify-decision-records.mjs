#!/usr/bin/env node
// Checks docs/decisions/{proposed,implemented,archived} against the M1 convention:
// - filenames match YYYY-MM-DD-slug.(zh|en).md
// - required sections are present, no unfilled {template} placeholders
// - implemented/archived records have both a .zh.md and a .en.md file
// - archived records match their frozen content hash (append-only manifest)

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "decisions");
const STATES = ["proposed", "implemented", "archived"];
const IGNORE = new Set([".gitkeep", ".manifest.json"]);
const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.(zh|en)\.md$/;

const REQUIRED_HEADINGS = {
  zh: ["## 决定了什么", "## 背景", "## 考虑过的替代方案", "## 为什么这样选"],
  en: ["## Decision", "## Context", "## Alternatives Considered", "## Why"],
};

const errors = [];

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    if (IGNORE.has(name) || name.startsWith("_")) return false;
    return statSync(join(dir, name)).isFile();
  });
}

function checkRecordFormat(state, file, fullPath) {
  const match = FILENAME_RE.exec(file);
  if (!match) {
    errors.push(`${state}/${file}: 文件名必须匹配 YYYY-MM-DD-slug.(zh|en).md`);
    return null;
  }
  const [, date, slug, lang] = match;
  const content = readFileSync(fullPath, "utf8");
  if (/\{\{[^}]+\}\}/.test(content)) {
    errors.push(`${state}/${file}: 还留有未填写的模板占位符 {{...}}`);
  }
  for (const heading of REQUIRED_HEADINGS[lang]) {
    if (!content.includes(heading)) {
      errors.push(`${state}/${file}: 缺少必需章节 "${heading}"`);
    }
  }
  return { date, slug, lang };
}

const pairKeys = new Map(); // "state/date-slug" -> Set<lang>

for (const state of STATES) {
  const dir = join(ROOT, state);
  for (const file of listFiles(dir)) {
    const info = checkRecordFormat(state, file, join(dir, file));
    if (!info) continue;
    if (state === "proposed") continue; // proposed 阶段允许单语
    const key = `${state}/${info.date}-${info.slug}`;
    if (!pairKeys.has(key)) pairKeys.set(key, new Set());
    pairKeys.get(key).add(info.lang);
  }
}

for (const [key, langs] of pairKeys) {
  if (!langs.has("zh") || !langs.has("en")) {
    errors.push(`${key}: implemented/archived 记录必须同时有 .zh.md 和 .en.md`);
  }
}

// 归档冻结检查：哈希清单只允许追加，不允许改动或删除已登记的条目
const archivedDir = join(ROOT, "archived");
const manifestPath = join(archivedDir, ".manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const updateMode = process.argv.includes("--update-manifest");
let manifestChanged = false;

const archivedFiles = new Set(listFiles(archivedDir));

for (const file of archivedFiles) {
  const hash = createHash("sha256")
    .update(readFileSync(join(archivedDir, file)))
    .digest("hex");
  if (manifest[file] === undefined) {
    if (updateMode) {
      manifest[file] = hash;
      manifestChanged = true;
    } else {
      errors.push(
        `archived/${file}: 不在冻结哈希清单里，运行 node scripts/verify-decision-records.mjs --update-manifest 登记`,
      );
    }
  } else if (manifest[file] !== hash) {
    errors.push(`archived/${file}: 内容与冻结时的哈希不一致，归档后的记录不允许再编辑`);
  }
}

for (const file of Object.keys(manifest)) {
  if (!archivedFiles.has(file)) {
    errors.push(`archived/.manifest.json 记录了 ${file}，但文件已被删除，归档记录不允许删除`);
  }
}

if (updateMode && manifestChanged) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("已更新 archived/.manifest.json");
}

if (errors.length > 0) {
  console.error("决策记录格式检查失败：\n");
  for (const error of errors) console.error(" - " + error);
  process.exit(1);
}

console.log("决策记录格式检查通过。");
