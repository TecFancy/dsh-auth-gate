#!/usr/bin/env node
/**
 * Chinese prose gate.
 *
 * The bilingual pairing gate (`check-bilingual.mjs`) owns structure: the three
 * files of a pair, the recorded hashes, the language switcher, heading parity,
 * link locale. It deliberately says nothing about the Chinese itself, so a
 * sloppy counterpart passed it - the defect this gate closes.
 *
 * What is mechanically checkable about "reads like native Chinese technical
 * writing" is narrower than the phrase suggests, and this gate claims only that
 * narrow part:
 *
 *   1. Full-width punctuation in Chinese prose. A half-width `, ; : ! ? ( )`
 *      may not follow Chinese, with or without an intervening space; it stays
 *      inside code spans, numbers, and complete English fragments.
 *   2. Mixed-script spacing. One half-width space between Chinese and Latin
 *      words or digits, never two, and never a space beside a full-width mark.
 *   3. Half-width digits and Latin letters only (`123`, never `１２３`).
 *   4. Second person is 你, not 您.
 *   5. No forbidden rendering. `docs/i18n/terminology.md` is the terminology
 *      source of truth; its 「不要译作」 column is enforced here, so a rejected
 *      translation cannot drift back in through a new document.
 *   6. Proper nouns keep their canonical casing (GitHub, TypeScript, DeepSeek,
 *      never `github`/`Github`), except where the word is part of a longer
 *      identifier (a kebab-case package name, a colon-joined rule key).
 *   7. Chinese prose quotes with 「」, not straight quotes. `mask()` drops code
 *      spans, link targets, URLs and HTML tags first, so a straight quote inside
 *      a code span or a Markdown link title is never read as prose.
 *
 * What it cannot check, and the standard says so out loud: whether the two
 * sides say the same thing, whether a term is well chosen, and whether the
 * prose reads naturally. Those belong to review - see
 * `docs/i18n/prose-rules.md`, whose checklist is the reviewer's half.
 *
 * Scope: every committed `.zh.md`, minus `archived/` notes, which are frozen
 * historical snapshots and must never be rewritten to satisfy a new gate.
 * Enumeration comes from git plus an optional stdin list, the same two sources
 * `check-bilingual.mjs` uses, so a fixture is a supported input rather than a
 * special case.
 *
 * Exit codes: 0 clean, 1 violations, 2 environment fault (cannot enumerate the
 * corpus, cannot read the terminology table, cannot read a listed document).
 *
 * Usage:
 *   node scripts/check-zh-prose.mjs          # exit 1 on violations
 *   node scripts/check-zh-prose.mjs --self-test
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Parse this script's arguments. Every recognised argument is consumed and
 * anything left over is an error: a dropped `--root` scans the checkout while
 * the caller believes the run was redirected, and a dropped `-root` typo is the
 * same fail-open spelled by hand.
 */
function parseArgs(argv) {
  const fail = (message) => {
    console.error(`[check-zh-prose] ${message}`);
    process.exit(2);
  };
  const args = { selfTest: false, root: undefined, status: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--status") {
      args.status = true;
    } else if (arg === "--root" || arg.startsWith("--root=")) {
      if (args.root !== undefined) fail("--root given more than once");
      const value = arg === "--root" ? argv[i + 1] : arg.slice("--root=".length);
      if (!value || value.startsWith("--")) fail("--root needs a directory value");
      args.root = value;
      if (arg === "--root") i += 1;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));
const SELF_TEST = ARGS.selfTest;

const ROOT = (() => {
  if (ARGS.root === undefined) {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  }
  // An override may only point inside the system temp directory, so one aimed
  // at a real checkout cannot make the gate report green for the wrong tree.
  const resolved = path.resolve(ARGS.root);
  let tmp;
  try {
    tmp = realpathSync(os.tmpdir());
  } catch {
    console.error(`[check-zh-prose] cannot resolve the temp directory: ${os.tmpdir()}`);
    process.exit(2);
  }
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    console.error(`[check-zh-prose] --root does not exist: ${resolved}`);
    process.exit(2);
  }
  const rel = path.relative(tmp, real);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    console.error(`[check-zh-prose] refusing --root outside the temp directory: ${real}`);
    process.exit(2);
  }
  console.error(`[check-zh-prose] root override: ${real}`);
  return real;
})();

const TERMINOLOGY = path.join(ROOT, "docs", "i18n", "terminology.md");
/** Stems of the documents that carry both languages in one file. */
const SELF_BILINGUAL_NAMES = ["terminology", "style-samples"];
/**
 * Self-bilingual documents whose Chinese is still prose, scanned under their own
 * name. `terminology` is deliberately absent: its 不要译作 column is a list of
 * forbidden strings, so scanning it would feed the ban list back into the ban
 * check. `style-samples` was absent for no such reason, and a banned rendering
 * (逃生口 for the `--force` escape hatch) lived in the file that teaches style.
 */
const SELF_BILINGUAL_PROSE = ["docs/i18n/style-samples.md"];
const CJK = "\\u4e00-\\u9fff";

/**
 * The Chinese corpus: every listed `.zh.md` outside the frozen archive.
 *
 * `null` marks a failed enumeration and `[]` a successful empty one - the same
 * distinction `check-bilingual.mjs` draws, because collapsing them is how a
 * gate reports a green verdict about a tree it never read.
 */
function collectCorpus() {
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    listed = null;
  }
  let piped = [];
  try {
    piped = readFileSync(0, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // No stdin (a terminal, or an ordinary gate run): nothing extra.
  }
  // A piped entry names a file in the tree being scanned, and the `--root`
  // guard's whole purpose is that this gate reports on that tree and no other.
  // An absolute path or a `..` escape would make the verdict a statement about
  // a file the override never selected.
  for (const entry of piped) {
    const normalized = entry.split(path.sep).join("/");
    if (path.isAbsolute(entry) || normalized.split("/").includes("..")) {
      console.error(`[check-zh-prose] refusing a piped corpus entry outside the tree: ${entry}`);
      process.exit(2);
    }
  }
  if (listed === null && piped.length === 0) {
    console.error(
      "[check-zh-prose] cannot enumerate the corpus: `git ls-files` failed and no file list was piped on stdin",
    );
    process.exit(2);
  }
  const all = new Set([...(listed ?? []), ...piped]);
  return (
    [...all]
      .map((p) => p.split(path.sep).join("/"))
      .filter((rel) => rel.endsWith(".zh.md"))
      .filter((rel) => !rel.startsWith(".agents/notes/archived/"))
      // A document that carries both languages in one file is never prose,
      // whatever suffix a copy of it grows. Without this, a `terminology.zh.md`
      // would feed the ban column back into the ban check and report violations
      // no edit can clear.
      .filter((rel) => !SELF_BILINGUAL_NAMES.some((name) => rel.startsWith(`docs/i18n/${name}`)))
      .concat(SELF_BILINGUAL_PROSE.filter((rel) => all.has(rel)))
      .sort()
  );
}

/**
 * Read the terminology table's 「不要译作」 column: the renderings a document
 * must never use. A missing table is an environment fault, not "no forbidden
 * terms" - the fail-open this repository keeps getting bitten by.
 */
function readForbiddenTerms() {
  let text;
  try {
    text = readFileSync(TERMINOLOGY, "utf8");
  } catch (error) {
    const relTerminology = path.relative(ROOT, TERMINOLOGY).split(path.sep).join("/");
    console.error(`[check-zh-prose] cannot read ${relTerminology}: ${error.code ?? error.message}`);
    process.exit(2);
  }
  const terms = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    // | English | 中文 | 首次出现 | 不要译作 | 备注 |
    // Exactly five columns: a shorter row is the table's own separator, and a
    // longer one means the ban column moved without this parser moving.
    if (cells.length !== 5) continue;
    const [english, chinese, , forbidden] = cells;
    if (!english || english === "English" || /^-+$/.test(english)) continue;
    if (!forbidden || forbidden === "不要译作") continue;
    for (const raw of forbidden.split(/[、,，]/)) {
      const term = raw.trim();
      // A leading note in parentheses is annotation, not the banned string.
      if (!term || term.startsWith("（") || term.startsWith("(")) continue;
      if (term === "-") continue;
      terms.push({ term, english, chinese });
    }
  }
  return terms;
}

/**
 * Mask everything the rules must not read as prose, in place: code spans, link
 * targets, URLs, and HTML tags become `X`, while link text is kept. Masking is
 * per line without padding, so line numbers stay exact and a masked span cannot
 * fake a missing space next to the Chinese around it.
 */
function mask(line) {
  return line
    .replace(/`[^`]*`/g, "X")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "X")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "X")
    .replace(/<[^>]+>/g, "X");
}

/**
 * Proper nouns keep their canonical casing in prose. Per DSH
 * (deepseek-harness)'s translation-rules.md, the standard this gate is
 * itself an extension of: "Proper nouns keep their canonical casing:
 * GitHub, TypeScript, DeepSeek - never `github`/`Github` unless quoting
 * code." Implemented as its own scan rather than folded into
 * `CONTENT_RULES`: those report on any match, and this one must report only
 * a wrong casing while staying silent on the canonical one, which a single
 * regex-plus-message pair cannot express.
 *
 * The false-positive risk here is not code spans - `mask()` already strips
 * those - it is kebab-case package and skill names
 * (`vite-plugin-fsd-slice-creator`, `eslint-plugin-jsx-a11y`,
 * `typescript-best-practices`) and colon-joined rule keys
 * (`typescript:S6819`), all confirmed present in this repo's own corpus,
 * sitting in ordinary prose or inside a markdown link's kept text rather
 * than inside a code span. A miscased word is therefore a violation only
 * when it stands alone: no letter, digit, `-`, `_`, `.` or `:` on either
 * side.
 */
const PROPER_NOUNS = [
  "GitHub",
  "TypeScript",
  "JavaScript",
  "ESLint",
  "Prettier",
  "Vite",
  "DeepSeek",
];
const IDENTIFIER_ADJACENT = "A-Za-z0-9\\-_./:";
const PROPER_NOUN_PATTERN = new RegExp(
  `(?<![${IDENTIFIER_ADJACENT}])(${PROPER_NOUNS.join("|")})(?![${IDENTIFIER_ADJACENT}])`,
  "gi",
);

/**
 * Chinese prose quotes with 「」. `docs/i18n/prose-rules.md` states the rule as
 * a MUST - straight quotes belong to code and complete English fragments - and
 * this is the half of it a machine can see. `mask()` runs first, so what this
 * reads is prose only: a straight quote inside a code span, a Markdown link
 * target, a bare URL or an HTML tag is already gone, and none of those can be
 * reported as a quote defect.
 *
 * Quotes pair the way a reader pairs them - first with second, third with
 * fourth - and a pair is a violation when its content holds a Han character.
 * Searching instead for "two quotes with Han between them" silently pairs a
 * closing English quote with the next opening one, so `一份标题里带 "plan" 的
 * "是什么"页面` would be reported as `" 的"`: a span nobody wrote, whose
 * suggested rewrite is not the one the line needs.
 *
 * Limits, stated rather than implied: pairing is per line, so a span broken
 * across a line break is read as two unpaired quotes, and an unpaired trailing
 * quote is ignored rather than guessed at.
 */
const HAN = /[\u4e00-\u9fff]/;
const STRAIGHT_QUOTE = '"';
function straightQuotedChinese(line) {
  const marks = [];
  for (let at = 0; at < line.length; at += 1) {
    if (line[at] === STRAIGHT_QUOTE) marks.push(at);
  }
  const quoted = [];
  for (let k = 0; k + 1 < marks.length; k += 2) {
    const content = line.slice(marks[k] + 1, marks[k + 1]);
    if (HAN.test(content)) quoted.push(content);
  }
  return quoted;
}

/**
 * Rules that read words rather than layout. They apply to prose and to table
 * cells alike: half-width punctuation inside a table is the same defect as
 * half-width punctuation in a paragraph, and a table is exactly where a term's
 * renderings accumulate.
 */
const CONTENT_RULES = [
  {
    id: "full-width-punctuation",
    // Zero or more spaces, not adjacency: `中文 , 中文` is the shape this rule
    // exists to reject, and an adjacency-only pattern is the one way to write
    // that defect past the gate.
    //
    // The pattern deliberately anchors on Chinese *before* the mark. A
    // half-width mark that follows an English token - `# Agent Note: <title>`,
    // `**ui**: 一个最小组件` - belongs to that token, and demanding a full-width
    // mark there would contradict the rule that machine tokens stay English.
    // The remaining gap is a mark that follows Latin and precedes Chinese
    // (`foo, 然后`); the two-pass review owns that one.
    pattern: new RegExp(`[${CJK}] *[,;:!?()]`),
    message: (m) =>
      `half-width punctuation after Chinese: ${JSON.stringify(m)} - use ，。：；？！（）`,
  },
  {
    id: "full-width-digits",
    pattern: /[０-９Ａ-Ｚａ-ｚ]/u,
    message: (m) => `full-width digit or letter: ${JSON.stringify(m)} - use half-width`,
  },
  {
    id: "second-person",
    pattern: /您/u,
    message: () => "「您」 - this repository addresses the reader as 你",
  },
];

/**
 * Rules that read spacing. Table rows are exempt: their padding is structural,
 * and `| 字段 | 含义 |` carries legitimate runs of spaces next to a full-width
 * mark. The split is two arrays rather than one flag so a word rule cannot ride
 * along with the layout exemption.
 */
const SPACING_RULES = [
  {
    id: "mixed-script-spacing",
    pattern: new RegExp(`[${CJK}][A-Za-z0-9]|[A-Za-z0-9][${CJK}]`),
    message: (m) =>
      `missing one half-width space between Chinese and Latin/digits: ${JSON.stringify(m)}`,
  },
  {
    id: "doubled-space",
    pattern: new RegExp(`[${CJK}] {2,}[${CJK}]|[${CJK}] {2,}[A-Za-z0-9]|[A-Za-z0-9] {2,}[${CJK}]`),
    message: (m) => `doubled space around Chinese: ${JSON.stringify(m)}`,
  },
  {
    id: "spacing-beside-full-width",
    pattern: new RegExp(` +[，。：；？！）]|[，。：；？！（] +`),
    message: (m) => `space beside a full-width punctuation mark: ${JSON.stringify(m)}`,
  },
];

const RULES = [...CONTENT_RULES, ...SPACING_RULES];

function checkDocument(rel, text, forbidden) {
  const problems = [];
  const lines = text.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    // Fenced code is verbatim, comments and all, in either language.
    if (inFence) continue;
    const line = mask(raw);
    // A table row is read by the content rules and by none of the spacing
    // rules; every other line is read by both.
    const isTableRow = /^\s*\|/.test(line);
    const applicable = isTableRow ? CONTENT_RULES : RULES;
    {
      for (const rule of applicable) {
        const match = rule.pattern.exec(line);
        // A pattern that can match the empty string - an anchored typo, or a
        // blank line under one - must not report a violation for text it never
        // matched: a report quoting `""` is unactionable, it fires on every
        // blank line, and it lets a disabled rule keep exiting 1 for the wrong
        // reason instead of failing the case that pins it.
        if (match && match[0] !== "") problems.push(`${rel}:${i + 1}: ${rule.message(match[0])}`);
      }
    }
    for (const { term, english, chinese } of forbidden) {
      if (line.includes(term)) {
        problems.push(
          `${rel}:${i + 1}: forbidden rendering ${JSON.stringify(term)} for ${english} - write ${JSON.stringify(chinese)}`,
        );
      }
    }
    PROPER_NOUN_PATTERN.lastIndex = 0;
    let pnMatch;
    while ((pnMatch = PROPER_NOUN_PATTERN.exec(line))) {
      const found = pnMatch[0];
      const canonical = PROPER_NOUNS.find((n) => n.toLowerCase() === found.toLowerCase());
      if (found !== canonical) {
        problems.push(
          `${rel}:${i + 1}: proper noun not in its canonical casing: ${JSON.stringify(found)} - write ${JSON.stringify(canonical)}`,
        );
      }
    }
    for (const quoted of straightQuotedChinese(line)) {
      problems.push(
        `${rel}:${i + 1}: Chinese prose in straight quotes: ${JSON.stringify(`"${quoted}"`)} - write 「${quoted}」`,
      );
    }
  }
  return problems;
}

async function main() {
  if (SELF_TEST) {
    await selfTest();
    return;
  }
  const corpus = collectCorpus();
  const forbidden = readForbiddenTerms();
  const problems = [];
  for (const rel of corpus) {
    const abs = path.join(ROOT, rel);
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch (error) {
      // Listed but unreadable is an environment fault: it is not a verdict
      // about the document, and treating it as one would let a deleted file
      // read as a clean corpus.
      console.error(`[check-zh-prose] cannot read ${rel}: ${error.code ?? error.message}`);
      process.exit(2);
    }
    problems.push(...checkDocument(rel, text, forbidden));
  }
  if (problems.length) {
    for (const p of problems) console.error(`[check-zh-prose] FAIL: ${p}`);
    console.error(`[check-zh-prose] ${problems.length} problem(s) in ${corpus.length} documents.`);
    // `--status` is the census: it reports the same findings and never fails, so
    // the backlog can be measured before the rule becomes blocking. The default
    // run fails, which is what `verify` and CI use.
    if (ARGS.status) {
      console.log("[check-zh-prose] --status: reporting only, not failing.");
      return;
    }
    process.exit(1);
  }
  console.log(
    `[check-zh-prose] OK - ${corpus.length} Chinese documents, ${forbidden.length} forbidden rendering(s) enforced.`,
  );
}

/**
 * Repeatable negative tests. Each case is the rule it pins: an edit that stops
 * reporting one of them fails here instead of shipping, and every exemption
 * (code spans, fenced blocks, table padding) has a case of its own so it cannot
 * quietly widen into "nothing is checked".
 */
async function selfTest() {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-zh-prose-selftest-"));
  const failures = [];

  const DOCS = path.join(tmp, "docs");
  const I18N = path.join(DOCS, "i18n");
  const ZH = path.join(DOCS, "sample.zh.md");
  const TERMS = path.join(I18N, "terminology.md");

  const TERMINOLOGY_TEXT = [
    "# Terminology",
    "",
    "| English | 中文 | 首次出现 | 不要译作 | 备注 |",
    "|---|---|---|---|---|",
    "| gate | 门禁 | | 关卡、卡口 | |",
    "| note | 笔记 | | 智能体注记 | |",
    "",
  ].join("\n");

  const run = (files, extra = {}) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", tmp], {
      env: { ...process.env },
      encoding: "utf8",
      input: files.join("\n") + "\n",
      ...extra,
    });
  const expect = (name, result, code, needle) => {
    if (result.status !== code) {
      failures.push(`${name}: expected exit ${code}, got ${result.status}`);
      return;
    }
    const out = `${result.stdout}${result.stderr}`;
    if (needle && !out.includes(needle)) {
      failures.push(`${name}: output missing ${JSON.stringify(needle)}`);
    }
  };
  const write = (p, body) => writeFile(p, body);

  try {
    await mkdir(I18N, { recursive: true });
    await write(TERMS, TERMINOLOGY_TEXT);
    await write(path.join(DOCS, "sample.md"), "# Sample\n");

    // 1. A compliant document passes, so every case below differs only in the
    //    rule under test.
    await write(ZH, "# 标题\n\n中文 与 Latin 之间有一个半角空格，标点是全角的。\n");
    expect("clean document", run(["docs/sample.zh.md"]), 0, "OK");

    // 2. Half-width punctuation touching Chinese is a violation.
    await write(ZH, "# 标题\n\n这里用了半角逗号,然后继续。\n");
    expect("half-width punctuation", run(["docs/sample.zh.md"]), 1, "half-width punctuation");

    // 3. A missing space between Chinese and Latin is a violation.
    await write(ZH, "# 标题\n\n这里的gate没有空格。\n");
    expect("missing space", run(["docs/sample.zh.md"]), 1, "missing one half-width space");

    // 4. A doubled space is not a substitute for the single required space.
    await write(ZH, "# 标题\n\n这里的  gate  有两个空格。\n");
    expect("doubled space", run(["docs/sample.zh.md"]), 1, "doubled space");

    // 5. A space beside a full-width mark is a violation.
    await write(ZH, "# 标题\n\n标点前面有空格 ：这里。\n");
    expect("space beside punctuation", run(["docs/sample.zh.md"]), 1, "beside a full-width");

    // 6. Full-width digits and Latin letters are a violation.
    await write(ZH, "# 标题\n\n版本号写成 １２３ 不行。\n");
    expect("full-width digits", run(["docs/sample.zh.md"]), 1, "full-width digit or letter");

    // 7. 您 is not this repository's second person.
    await write(ZH, "# 标题\n\n请您运行命令。\n");
    expect("second person", run(["docs/sample.zh.md"]), 1, "「您」");

    // 8. A forbidden rendering from the terminology table is a violation, and
    //    the report names the term to use instead.
    await write(ZH, "# 标题\n\n这个卡口会拦住提交。\n");
    expect("forbidden rendering", run(["docs/sample.zh.md"]), 1, "forbidden rendering");
    expect("forbidden rendering names the replacement", run(["docs/sample.zh.md"]), 1, "门禁");

    // 8b. A proper noun outside its canonical casing is a violation, and the
    //     report names the casing to use instead.
    await write(ZH, "# 标题\n\n这个项目用 vite 构建。\n");
    expect(
      "proper noun casing",
      run(["docs/sample.zh.md"]),
      1,
      "proper noun not in its canonical casing",
    );
    expect("proper noun casing names the replacement", run(["docs/sample.zh.md"]), 1, '"Vite"');

    // 8c. The canonical spelling itself is never a violation.
    await write(ZH, "# 标题\n\n这个项目用 Vite 构建。\n");
    expect("proper noun canonical spelling passes", run(["docs/sample.zh.md"]), 0, "OK");

    // 8d. The same lower-case word inside a longer kebab-case identifier is
    //     not the proper noun on its own - this repo's own corpus has
    //     `vite-plugin-fsd-slice-creator` and `typescript:S6819` in ordinary
    //     prose, and flagging those would be a false positive on day one.
    await write(
      ZH,
      "# 标题\n\n这个 vite-plugin-demo 插件和 `typescript:S1234` 规则都是标识符的一部分。\n",
    );
    expect("proper noun identifier exemption", run(["docs/sample.zh.md"]), 0, "OK");

    // 8e. Chinese prose quotes with 「」. A straight-quoted span holding a Han
    //     character is the MUST `prose-rules.md` states, and the report shows
    //     the quoted text so the rewrite is mechanical.
    await write(ZH, '# 标题\n\n他说 "重录" 之后才算确认。\n');
    expect("straight quotes around Chinese", run(["docs/sample.zh.md"]), 1, "straight quotes");
    expect("straight-quote report shows the text", run(["docs/sample.zh.md"]), 1, "「重录」");

    // 8f. 「」 itself is never a violation, or the rule would have no legal form.
    await write(ZH, "# 标题\n\n他说「重录」之后才算确认。\n");
    expect("「」 quotes pass", run(["docs/sample.zh.md"]), 0, "OK");

    // 8g. A straight-quoted English fragment is allowed: the rule is about
    //     Chinese prose, and `"--write"` is not Chinese.
    await write(ZH, '# 标题\n\n参数写作 "--write" 时才会落盘。\n');
    expect("straight-quoted English fragment passes", run(["docs/sample.zh.md"]), 0, "OK");

    // 8h. `mask()` drops code spans and link targets before the scan, so a
    //     straight quote inside either is invisible. Without that, a quoted
    //     counter-example and a Markdown link title would both be reported as
    //     prose defects, and the fix for the title would break the link.
    await write(ZH, '# 标题\n\n反例 `他说 "重录"`，以及 [链接](https://example.com/ "标题")。\n');
    expect(
      "straight quotes in code spans and link titles pass",
      run(["docs/sample.zh.md"]),
      0,
      "OK",
    );

    // 8i. Quotes pair as a reader pairs them. A Han-searching regex pairs the
    //     closing quote of `"plan"` with the next opening one and reports
    //     `" 的"` - a span nobody wrote, whose rewrite is not the one this line
    //     needs. The English fragment stays; the Chinese pair is reported.
    await write(ZH, '# 标题\n\n一份标题里带 "plan" 的"是什么"页面。\n');
    expect("straight-quote pairing", run(["docs/sample.zh.md"]), 1, "「是什么」");

    // 8j. An unpaired quote is ignored rather than guessed at: guessing is how
    //     a report sends a writer to fix a span they never wrote.
    await write(ZH, '# 标题\n\n这里只有一个引号 "没有闭合。\n');
    expect("unpaired quote is ignored", run(["docs/sample.zh.md"]), 0, "OK");

    // 9. A code span is verbatim: punctuation and spacing inside it are never
    //    a prose violation, which is what lets the standard quote bad examples.
    await write(ZH, "# 标题\n\n反例 `配置,然后继续` 放在行内代码里。\n");
    expect("code span exemption", run(["docs/sample.zh.md"]), 0, "OK");

    // 10. A fenced block is verbatim for the same reason.
    await write(ZH, "# 标题\n\n```text\n配置,然后继续\n```\n");
    expect("fenced block exemption", run(["docs/sample.zh.md"]), 0, "OK");

    // 11. Table padding is structural, so the spacing rules do not read it.
    await write(ZH, "# 标题\n\n| 字段 | 含义 |\n|---|---|\n| 门禁 | 检查    通过 |\n");
    expect("table padding exemption", run(["docs/sample.zh.md"]), 0, "OK");

    // 12. A tree this gate cannot enumerate is an environment fault, never a
    //     green verdict about a corpus it never read.
    const noInput = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", tmp], {
      env: { ...process.env },
      encoding: "utf8",
      input: "",
    });
    expect("enumeration fault", noInput, 2, "cannot enumerate the corpus");

    // 13. A missing terminology table is an environment fault too: without it
    //     the forbidden-rendering rule would silently pass everything.
    await rm(TERMS, { force: true });
    expect("missing terminology table", run(["docs/sample.zh.md"]), 2, "cannot read docs/i18n");
    await write(TERMS, TERMINOLOGY_TEXT);

    // 14. A document the corpus lists but the tree does not hold is an
    //     environment fault, not a clean document.
    expect("unreadable document", run(["docs/gone.zh.md"]), 2, "cannot read docs/gone.zh.md");

    // 15. The frozen archive is out of scope: a historical snapshot keeps its
    //     old typography rather than being rewritten to satisfy a new gate.
    await mkdir(path.join(tmp, ".agents", "notes", "archived"), { recursive: true });
    await write(
      path.join(tmp, ".agents", "notes", "archived", "old.zh.md"),
      "# 旧标题\n\n这里用了半角逗号,而且没有空格gate。\n",
    );
    expect("archived notes out of scope", run([".agents/notes/archived/old.zh.md"]), 0, "OK");
    // 16. A table row is prose for the word rules. Half-width punctuation inside
    //     a table was the one way to write the defect past this gate, and a term
    //     table is exactly where a new document collects its renderings.
    await write(ZH, "# 标题\n\n| 字段 | 含义 |\n|---|---|\n| 配置,然后继续 | x |\n");
    expect("half-width punctuation in a table", run(["docs/sample.zh.md"]), 1, "half-width");

    // 17. A half-width mark that only a space separates from Chinese is the same
    //     defect: `中文 , 中文` is what the counter-example table rejects, and an
    //     adjacency-only rule would let it through.
    await write(ZH, "# 标题\n\n这里用了半角逗号 , 然后继续。\n");
    expect("spaced half-width punctuation", run(["docs/sample.zh.md"]), 1, "half-width");

    // 18. A forbidden rendering inside a code span is a quotation, not prose: the
    //     mask runs before the ban check, which is what lets a note name the
    //     rendering it replaced. The term must be one this fixture's table
    //     actually bans - `卡口`, not a rendering the fixture never forbade,
    //     which would leave the case green for a reason nobody chose.
    await write(ZH, "# 标题\n\n旧的 `卡口` 写法已经统一。\n");
    expect("forbidden rendering inside a code span", run(["docs/sample.zh.md"]), 0, "OK");

    // 19. A document that is bilingual by construction is out of scope even when
    //     a copy of it carries a locale suffix. Otherwise the ban column feeds
    //     itself and reports violations no edit can clear.
    await write(path.join(I18N, "terminology.zh.md"), "# 术语表\n\n| 门禁 | 关卡 |\n");
    expect("self-bilingual document with a suffix", run(["docs/i18n/terminology.zh.md"]), 0, "OK");
    await rm(path.join(I18N, "terminology.zh.md"), { force: true });

    // 19b. `style-samples` is bilingual by construction but its Chinese is still
    //      prose, so it is scanned under its own name. The exemption was copied
    //      from the terminology table without the reason that justifies it, and a
    //      banned rendering lived in the file that teaches style.
    await write(
      path.join(I18N, "style-samples.md"),
      "# 语体样例\n\n门禁拦不住时用 `--force`，那是卡口。\n",
    );
    expect(
      "self-bilingual style file is scanned",
      run(["docs/i18n/style-samples.md"]),
      1,
      "forbidden",
    );
    await write(
      path.join(I18N, "style-samples.md"),
      "# 语体样例\n\n门禁拦不住时用 `--force`，那是**逃生舱**。\n",
    );
    expect("self-bilingual style file passes", run(["docs/i18n/style-samples.md"]), 0, "OK");
    await rm(path.join(I18N, "style-samples.md"), { force: true });

    // 20. A piped entry outside the tree is refused: the `--root` guard exists so
    //     that a verdict is about the tree the override selected.
    expect(
      "piped entry outside the tree",
      run(["/etc/hosts"]),
      2,
      "refusing a piped corpus entry outside the tree",
    );
    expect(
      "piped entry escaping the tree",
      run(["../../etc/hosts"]),
      2,
      "refusing a piped corpus entry outside the tree",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // 15. No rule may match the empty string. Such a pattern reports a violation
  //     for text it never matched - on every blank line - which is how a
  //     disabled rule keeps exiting 1 for the wrong reason instead of failing
  //     the case that pins it. The check loop skips empty matches as well; this
  //     case keeps that guard unreachable rather than load-bearing, because a
  //     defensive branch no fixture can reach is a branch nothing verifies.
  for (const rule of RULES) {
    if (rule.pattern.test("") || rule.pattern.test(" ")) {
      failures.push(`rule ${rule.id}: pattern matches the empty string`);
    }
  }
  // The standalone scans report outside the RULES loop, so the invariant above
  // never reaches them: assert the same property directly rather than assume it.
  for (const [name, pattern] of [
    ["proper-noun", PROPER_NOUN_PATTERN],
    ["han-in-quotes", HAN],
  ]) {
    pattern.lastIndex = 0;
    if (pattern.test("") || pattern.test(" ")) {
      failures.push(`scan ${name}: pattern matches the empty string`);
    }
  }

  const spawnRoot = (args, env) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  const { runGuardCases } = await import("./lib/guard-cases.mjs");
  await runGuardCases({ spawnRoot, failures });

  if (failures.length) {
    for (const f of failures) console.error(`[check-zh-prose] SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    "[check-zh-prose] self-test passed (14 rule, exemption and scoping cases + proper-noun casing and identifier-exemption cases + straight-quote and quote-exemption cases + table, spacing, code-span, self-bilingual prose and stdin cases + the no-empty-match rule invariant + shared --root guard cases).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
