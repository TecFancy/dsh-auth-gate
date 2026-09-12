#!/usr/bin/env node
/**
 * Verifies documentation governance under docs/:
 *
 * 1. Bilingual pairing — every doc must ship in English + Chinese:
 *    - everywhere except decisions/: `<name>.md` (EN content) pairs with
 *      `<name>_zh.md` (ZH content)
 *    - decisions/ uses the official `<date>-<slug>.en.md` + `(zh).md` naming
 *    - `_template*` files pair like any other doc
 *    Exempt (single-language by design): docs/README.md navigation,
 *    docs/decisions.md index, demo/ assets, design/ exports (the ZH/EN
 *    folders themselves are the pair).
 * 2. Naming exceptions — historical inversions frozen as-is (must NOT grow):
 *    - totp-fix-plan.md holds Chinese content, totp-fix-plan.en.md English
 * 3. Size red line — single docs over 50 KiB must be sliced (skeleton +
 *    references/). Frozen specs over the line are exempted by exact path and
 *    are expected to be split at their next revision, not extended further.
 * 4. Duplicate headings — one file must not repeat the same H2/H3/H4 heading
 *    (a copy-paste accident). The repo-root READMEs are in scope as well: the
 *    historical accident was a byte-identical `## Troubleshooting` block in
 *    README.md, which `docs/`-only pairing checks could never see.
 *
 * Run via `npm run docs:check` (part of `npm run verify`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOCS_DIR = join(ROOT, "docs");
const SIZE_LIMIT = 50 * 1024; // 50 KiB

/** 单语豁免（按 docs/ 相对路径）。 */
const SINGLE_LANG_ALLOWED = new Set(["README.md", "decisions.md"]);
/** 目录级豁免（前缀匹配 docs/ 相对路径）。 */
const DIRECTORY_EXEMPT = [/^demo\//, /^design\//];
/** 命名反转例外：`<base>.md` = 中文、`<base>.en.md` = 英文（历史遗留，禁止新增）。 */
const REVERSED_PAIRS = new Set(["totp-fix-plan"]);
/** 大小红线豁免（frozen spec，冻结期不动；新超限文档必须切片）。 */
const SIZE_EXEMPT = new Set([
  "implemented/impl-m3.md",
  "implemented/impl-m3_zh.md",
  "implemented/totp-fix-plan.en.md",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (extname(full) === ".md") out.push(full);
  }
  return out;
}

const errors = [];
const files = walk(DOCS_DIR);
/** key = base 相对路径（去语言后缀），value = { md?, zh?, en?, decisions?: boolean } */
const pairs = new Map();

for (const full of files) {
  const rel = relative(DOCS_DIR, full).split("\\").join("/");
  if (SINGLE_LANG_ALLOWED.has(rel) || DIRECTORY_EXEMPT.some((re) => re.test(rel))) continue;

  const isDecisions = rel.startsWith("decisions/");
  const name = rel.split("/").pop();
  let base;
  let kind;
  if (isDecisions) {
    const m = /^(.*)\.(en|zh)\.md$/.exec(name);
    if (m === null) {
      if (rel === "decisions/README.md") continue; // 单语豁免
      errors.push(`${rel}: decisions/ 命名必须是 <name>.(en|zh).md`);
      continue;
    }
    base = rel.slice(0, rel.length - name.length) + m[1];
    kind = m[2];
  } else if (/(.*)\.en\.md$/.test(name) && REVERSED_PAIRS.has(RegExp.$1)) {
    base = rel.slice(0, -".en.md".length);
    kind = "en";
  } else if (REVERSED_PAIRS.has(name.replace(/\.md$/, ""))) {
    base = rel.slice(0, -".md".length);
    kind = "md";
  } else if (name.endsWith("_zh.md")) {
    base = rel.slice(0, -"_zh.md".length);
    kind = "zh";
  } else {
    base = rel.slice(0, -".md".length);
    kind = "md";
  }
  if (!pairs.has(base)) pairs.set(base, {});
  const entry = pairs.get(base);
  entry[kind] = rel;
  if (isDecisions) entry.decisions = true;
}

// 配对完整性
for (const [base, langs] of pairs) {
  if (langs.decisions) {
    if (!langs.en || !langs.zh) {
      const have =
        Object.values(langs)
          .filter((v) => typeof v === "string")
          .join(", ") || "(none)";
      errors.push(`${base}.(en|zh).md: decisions/ 必须双语成对；现有: ${have}`);
    }
    continue;
  }
  if (REVERSED_PAIRS.has(base.split("/").pop())) {
    if (!langs.md || !langs.en) {
      const have =
        Object.values(langs)
          .filter((v) => typeof v === "string")
          .join(", ") || "(none)";
      errors.push(
        `${base}: 命名反转例外要求 <base>.md (ZH) + <base>.en.md (EN) 成对；现有: ${have}`,
      );
    }
    continue;
  }
  if (!langs.md || !langs.zh) {
    const have =
      Object.values(langs)
        .filter((v) => typeof v === "string")
        .join(", ") || "(none)";
    errors.push(`${base}: 必须成对 <name>.md (EN) + <name>_zh.md (ZH)；现有: ${have}`);
  }
}

// 大小红线
for (const full of files) {
  const rel = relative(DOCS_DIR, full).split("\\").join("/");
  if (SINGLE_LANG_ALLOWED.has(rel) || DIRECTORY_EXEMPT.some((re) => re.test(rel))) continue;
  if (SIZE_EXEMPT.has(rel)) continue;
  const size = statSync(full).size;
  if (size > SIZE_LIMIT) {
    const lines = readFileSync(full, "utf8").split("\n").length;
    errors.push(
      `${rel}: ${size} bytes / ${lines} lines 超过 50 KiB 红线，必须切片（骨架 + references/）`,
    );
  }
}

/**
 * 4. 重复标题: 同一文件里同一个 H2/H3/H4 标题出现两次 = 复制粘贴事故。
 *    范围含仓库根 README（历史事故就发生在根 README，docs/ 下的检查看不见）。
 *    围栏代码块里的 `#` 行不算标题。
 */
const HEADING = /^(#{2,4})\s+(.+?)\s*$/;
const FENCE = /^\s*```/;
const SCAN_DUPLICATE_HEADINGS = [
  ...files,
  ...["README.md", "README.zh.md"].map((name) => join(ROOT, name)),
];
for (const full of SCAN_DUPLICATE_HEADINGS) {
  if (!existsSync(full)) continue;
  const rel = relative(ROOT, full).split("\\").join("/");
  const seen = new Map();
  const lines = readFileSync(full, "utf8").split("\n");
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = HEADING.exec(line);
    if (match === null) continue;
    const key = `${match[1]} ${match[2].toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(key, i + 1);
      continue;
    }
    errors.push(
      `${rel}: 第 ${i + 1} 行标题 "${line}" 与第 ${seen.get(key)} 行重复（同一文件禁止重复 H2-H4 标题）`,
    );
  }
}

if (errors.length > 0) {
  console.error("docs:check FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `OK: docs bilingual pairing + size red line + duplicate-heading scan verified (${files.length} docs + root READMEs)`,
);
