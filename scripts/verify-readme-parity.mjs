#!/usr/bin/env node
/**
 * README parity gate (`npm run readme:parity`).
 *
 * The two root READMEs are this product's front door in English and Chinese, and they
 * drifted before: the Chinese file was 283 lines against the English 352, having
 * silently dropped half of `Notes & limitations`, and both shared the same (Chinese)
 * screenshots. Prose is translated, structure is not negotiable, so this gate compares
 * the parts that must stay identical and fails loudly on drift:
 *
 * 1. **Sections** - both files carry the same number of `##` sections.
 * 2. **Shape** - per section, the same number of list items, fenced code blocks and
 *    `###` subsections (a translation may be shorter, it may not lose blocks).
 * 3. **Images** - same count, every path exists on disk, and locale-suffixed assets stay
 *    on their side: `*.zh.png` must not appear in README.md, `*.en.png` not in
 *    README.zh.md.
 * 4. **Link targets** - the same set of relative repository paths is referenced by both
 *    after collapsing language suffixes (`deployment.md` == `deployment_zh.md`), so a
 *    translation cannot silently drop a reference; the language switch is excluded.
 * 5. **Contents list** - each README's table of contents lists exactly its own `##`
 *    headings, in order, using GitHub's anchor slugs.
 *
 * Run via `npm run verify`. Exits non-zero with every violation listed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = { en: "README.md", zh: "README.zh.md" };
const SWITCH_LINKS = new Set(["README.md", "README.zh.md"]);
const errors = [];
const note = (message) => errors.push(message);

/** 切出 `##` 段（标题 + 段体）。 */
function sectionsOf(text) {
  const sections = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) sections.push({ title: line.slice(3).trim(), body: [] });
    else if (sections.length > 0) sections.at(-1).body.push(line);
  }
  return sections.map((section) => ({ title: section.title, body: section.body.join("\n") }));
}

/** 一段的结构指纹：列表项、围栏代码块、`###` 小节。 */
function shapeOf(body) {
  const counts = { bullets: 0, code: 0, h3: 0 };
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      if (fenced) counts.code += 1;
      continue;
    }
    if (fenced) continue;
    if (/^([-*]|\d+\.) /.test(line)) counts.bullets += 1;
    if (/^### /.test(line)) counts.h3 += 1;
  }
  return counts;
}

/** 括号里的目标（图片除外）。 */
function targetsOf(text) {
  const all = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  return all.filter((target) => !target.startsWith("http") && !target.startsWith("#"));
}

/** 本地图片引用。 */
function imagesOf(text) {
  return [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((path) => !path.startsWith("http"));
}

/**
 * 语言后缀归一：`x_zh.md`（本仓惯例）、`x.zh.md` / `x.en.md`、`x.zh.png` / `x.en.png`
 * 在跨语言比较时视作同一个目标 - 两份 README 本来就该各链自己语言的版本。
 */
function normalizeTarget(target) {
  return target.replace(/_zh\.(md|png)$/, ".$1").replace(/\.(?:en|zh)\.(md|png)$/, ".$1");
}

/** GitHub 的锚点规则：小写、去标点（保留字母数字、空格、连字符）、空格换连字符。 */
function slugOf(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/ /g, "-");
}

/** 目录段里列出的锚点。 */
function anchorsOf(body) {
  return [...body.matchAll(/^[-*]\s+\[[^\]]+\]\(#([^)]+)\)/gm)].map((match) => match[1]);
}

const parsed = {};
for (const [locale, file] of Object.entries(FILES)) {
  const text = readFileSync(join(ROOT, file), "utf8");
  parsed[locale] = {
    file,
    text,
    sections: sectionsOf(text),
    images: imagesOf(text),
    targets: targetsOf(text)
      .filter((target) => !SWITCH_LINKS.has(target))
      .map(normalizeTarget),
  };
}

const { en, zh } = parsed;

if (en.sections.length !== zh.sections.length) {
  note(`section count: ${en.file} has ${en.sections.length}, ${zh.file} has ${zh.sections.length}`);
}
const shared = Math.min(en.sections.length, zh.sections.length);
for (let index = 0; index < shared; index += 1) {
  const a = shapeOf(en.sections[index].body);
  const b = shapeOf(zh.sections[index].body);
  const diff = ["bullets", "code", "h3"].filter((key) => a[key] !== b[key]);
  if (diff.length > 0) {
    const detail = diff.map((key) => `${key} ${a[key]} vs ${b[key]}`).join(", ");
    note(
      `section ${index + 1} shape: ${en.sections[index].title} / ${zh.sections[index].title} (${detail})`,
    );
  }
}

if (en.images.length !== zh.images.length) {
  note(`image count: ${en.images.length} vs ${zh.images.length}`);
}
for (const [locale, data] of Object.entries(parsed)) {
  for (const path of data.images) {
    if (!existsSync(join(ROOT, path))) note(`${data.file}: missing image ${path}`);
    if (locale === "en" && path.includes(".zh.")) note(`${data.file}: Chinese-only asset ${path}`);
    if (locale === "zh" && path.includes(".en.")) note(`${data.file}: English-only asset ${path}`);
  }
}

const enTargets = new Set(en.targets);
const zhTargets = new Set(zh.targets);
for (const target of enTargets)
  if (!zhTargets.has(target)) note(`only in ${en.file}: link ${target}`);
for (const target of zhTargets)
  if (!enTargets.has(target)) note(`only in ${zh.file}: link ${target}`);

for (const [locale, data] of Object.entries(parsed)) {
  const contents = data.sections.find((section) => anchorsOf(section.body).length > 1);
  if (contents === undefined) {
    note(`${data.file}: no table of contents found`);
    continue;
  }
  const listed = anchorsOf(contents.body);
  const expected = data.sections
    .filter((section) => section !== contents)
    .map((section) => slugOf(section.title));
  if (listed.join("|") !== expected.join("|"))
    note(`${data.file}: contents list does not match its headings`);
}

if (errors.length > 0) {
  console.error("readme:parity FAILED:");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(
  `OK: README parity verified (${en.sections.length} sections, ${en.images.length} images, ${enTargets.size} link targets)`,
);
