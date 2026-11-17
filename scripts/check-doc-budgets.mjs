#!/usr/bin/env node
/**
 * Doc word-budget gate (zero-dependency).
 *
 * The standing docs every agent loads (`AGENTS.md`, `docs/conventions.md`) grow
 * by accretion: each change adds a rule or a caveat, and nobody removes one.
 * Review did not stop that, so this gate puts a word ceiling on exactly those
 * files. `scripts/doc-budgets.json` lists them:
 *
 *   { "version": 1, "docs": [ { "path": "AGENTS.md", "max": 735 } ] }
 *
 * A listed doc must stay at or under its ceiling, counted with `wc -w` semantics
 * over the whole file (whitespace-separated tokens, front matter and tables
 * included, so the number matches what an author sees in a terminal). A listed
 * doc that no longer exists fails too, so a rename cannot silently orphan its
 * budget.
 *
 * Scope is narrow on purpose. Reference docs, notes and the skills are not
 * budgeted: a doc where every row is a fact is right to be long, and a blanket
 * ceiling only produces per-file raises that nobody reads. That is why
 * `docs/architecture.md` and `docs/security.md` are not listed even though they
 * are standing reading: they are reference, not rules. Only English files can be
 * listed. A whitespace count of Chinese text measures nothing, so a `.zh.md`
 * entry is refused instead of being given a number that looks like a budget (the
 * English twin's ceiling already bounds the translation).
 *
 * When this goes red, move the addition to the doc that owns it and leave a link,
 * or condense what is there. Raise a ceiling only when the content genuinely
 * needs the space, and say why in the change that raises it. A doc at or under
 * its target keeps about 5% headroom as its ceiling comes down.
 *
 * Usage:
 *   node scripts/check-doc-budgets.mjs              # exit 1 when a doc is over or missing
 *   node scripts/check-doc-budgets.mjs --self-test  # run the negative cases
 *
 * There is no `--root`: the self-test calls `check()` against throwaway trees, so
 * no flag can aim a real run at another tree and report green.
 *
 * Exit codes: 0 clean, 1 a doc over its ceiling or missing, 2 an environment
 * fault (the manifest is missing or malformed, a bad argument).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TAG = "[check-doc-budgets]";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_REL = "scripts/doc-budgets.json";

/** `wc -w`: runs of non-whitespace characters. */
export function countWords(text) {
  return (text.match(/\S+/g) ?? []).length;
}

/**
 * Parse and validate the manifest. Throws an Error whose message names the fault;
 * a manifest that cannot be trusted is an environment fault, not a violation.
 */
export function parseBudgets(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${MANIFEST_REL} is not valid JSON: ${error.message}`);
  }
  if (data === null || typeof data !== "object" || data.version !== 1) {
    throw new Error(`${MANIFEST_REL} must be an object with "version": 1`);
  }
  if (!Array.isArray(data.docs) || data.docs.length === 0) {
    throw new Error(`${MANIFEST_REL} must list at least one doc; an empty list checks nothing`);
  }
  const seen = new Set();
  for (const entry of data.docs) {
    const where = `${MANIFEST_REL} entry ${JSON.stringify(entry)}`;
    if (entry === null || typeof entry !== "object") throw new Error(`${where} is not an object`);
    const { path: docPath, max } = entry;
    if (typeof docPath !== "string" || docPath === "") throw new Error(`${where} has no "path"`);
    if (docPath.includes("\\") || path.posix.isAbsolute(docPath)) {
      throw new Error(`${where}: "path" must be repository-relative with forward slashes`);
    }
    const normal = path.posix.normalize(docPath);
    if (normal !== docPath || normal.startsWith("../") || normal === "..") {
      throw new Error(`${where}: "path" must be normalized and stay inside the repository`);
    }
    if (!docPath.endsWith(".md")) throw new Error(`${where}: only Markdown files are budgeted`);
    // Both bilingual suffixes are refused: `docs/` pairs as `foo_zh.md` and
    // `.agents/notes/` as `foo.zh.md`, and a whitespace count of either is
    // meaningless.
    if (docPath.endsWith(".zh.md") || docPath.endsWith("_zh.md")) {
      throw new Error(`${where}: a whitespace word count of Chinese text is meaningless`);
    }
    if (!Number.isSafeInteger(max) || max <= 0) {
      throw new Error(`${where}: "max" must be a positive integer`);
    }
    if (seen.has(docPath)) throw new Error(`${MANIFEST_REL} lists ${docPath} twice`);
    seen.add(docPath);
  }
  return data.docs.map(({ path: docPath, max }) => ({ path: docPath, max }));
}

/** Check every budgeted doc under `root`. Returns `{ problems, counts }`. */
export function check(root, budgets) {
  const problems = [];
  const counts = [];
  for (const { path: docPath, max } of budgets) {
    const abs = path.join(root, ...docPath.split("/"));
    if (!existsSync(abs)) {
      problems.push(
        `${docPath}: budgeted file is missing; if it was renamed or removed, update ${MANIFEST_REL}`,
      );
      continue;
    }
    const words = countWords(readFileSync(abs, "utf8"));
    counts.push({ path: docPath, words, max });
    if (words > max) {
      problems.push(
        `${docPath}: ${words} words, ceiling ${max} (${words - max} over). Move the addition to the doc that owns it and link it, or condense; raise the ceiling only with a stated reason.`,
      );
    }
  }
  return { problems, counts };
}

function parseArgs(argv) {
  const args = { selfTest: false };
  for (const arg of argv) {
    if (arg === "--self-test") {
      args.selfTest = true;
    } else {
      console.error(`${TAG} unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  let budgets;
  try {
    budgets = parseBudgets(readFileSync(path.join(REPO_ROOT, MANIFEST_REL), "utf8"));
  } catch (error) {
    console.error(`${TAG} cannot read the budgets: ${error.message}`);
    process.exit(2);
  }
  const { problems, counts } = check(REPO_ROOT, budgets);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${TAG} FAIL: ${problem}`);
    console.error(`${TAG} ${problems.length} problem(s). Fix and re-run.`);
    process.exit(1);
  }
  const summary = counts.map(({ path: p, words, max }) => `${p} ${words}/${max}`).join(", ");
  console.log(`${TAG} OK - ${counts.length} budgeted doc(s) within their ceilings (${summary}).`);
}

/** Negative cases, each against a throwaway tree so the real docs are never read. */
async function selfTest() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`${label}: got ${actual}, expected ${wanted}`);
  };

  // `wc -w` semantics.
  expect("empty text", countWords(""), 0);
  expect("whitespace only", countWords(" \n\t "), 0);
  expect("one word", countWords("word"), 1);
  expect("runs of whitespace", countWords("a  b\nc\t\td"), 4);
  expect("table pipes and front matter count", countWords("| a | b |\n---\nx: y"), 8);

  // The manifest must be refused when it cannot be trusted.
  const refused = (label, body, needle) => {
    try {
      parseBudgets(typeof body === "string" ? body : JSON.stringify(body));
      failures.push(`${label}: a bad manifest was accepted`);
    } catch (error) {
      if (!error.message.includes(needle)) {
        failures.push(`${label}: expected "${needle}", got "${error.message}"`);
      }
    }
  };
  const doc = (docPath, max) => ({ version: 1, docs: [{ path: docPath, max }] });
  refused("not json", "{", "not valid JSON");
  refused("wrong version", { version: 2, docs: [] }, 'must be an object with "version": 1');
  refused("empty list", { version: 1, docs: [] }, "an empty list checks nothing");
  refused("no path", { version: 1, docs: [{ max: 5 }] }, 'has no "path"');
  refused("backslash path", doc("docs\\a.md", 5), "forward slashes");
  refused("absolute path", doc("/etc/a.md", 5), "forward slashes");
  refused("escaping path", doc("../a.md", 5), "inside the repository");
  refused("unnormalized path", doc("docs/./a.md", 5), "normalized");
  refused("not markdown", doc("docs/a.txt", 5), "only Markdown");
  refused("chinese twin", doc("docs/a.zh.md", 5), "Chinese text is meaningless");
  // `docs/` uses the `_zh.md` suffix, so the refusal must cover it too; a gate
  // that only knew `.zh.md` would accept a Chinese doc and report a number that
  // looks like a budget.
  refused("chinese doc suffix", doc("docs/a_zh.md", 5), "Chinese text is meaningless");
  refused("zero ceiling", doc("a.md", 0), "positive integer");
  refused("fractional ceiling", doc("a.md", 1.5), "positive integer");
  refused("string ceiling", doc("a.md", "5"), "positive integer");
  refused(
    "duplicate",
    {
      version: 1,
      docs: [
        { path: "a.md", max: 5 },
        { path: "a.md", max: 6 },
      ],
    },
    "twice",
  );
  const parsed = parseBudgets(JSON.stringify(doc("docs/a.md", 5)));
  expect("accepted manifest", JSON.stringify(parsed), '[{"path":"docs/a.md","max":5}]');

  // The checking run, against throwaway trees.
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-doc-budgets-selftest-"));
  try {
    const build = async (name, files) => {
      const root = path.join(tmp, name);
      for (const [rel, body] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
        await writeFile(path.join(root, rel), body);
      }
      return root;
    };
    const words = (n) => `${Array.from({ length: n }, () => "w").join(" ")}\n`;
    const run = async (name, files, budgets) => check(await build(name, files), budgets);

    const under = await run("under", { "A.md": words(9) }, [{ path: "A.md", max: 10 }]);
    expect("under the ceiling", under.problems.length, 0);
    const exact = await run("exact", { "A.md": words(10) }, [{ path: "A.md", max: 10 }]);
    expect("exactly at the ceiling", exact.problems.length, 0);
    const over = await run("over", { "A.md": words(11) }, [{ path: "A.md", max: 10 }]);
    expect("one word over", over.problems.length, 1);
    if (!over.problems[0]?.includes("11 words, ceiling 10 (1 over)")) {
      failures.push(`over: the report did not name the counts: ${over.problems[0]}`);
    }
    const missing = await run("missing", {}, [{ path: "docs/gone.md", max: 10 }]);
    expect("missing file", missing.problems.length, 1);
    if (!missing.problems[0]?.includes("budgeted file is missing")) {
      failures.push(`missing: the report did not say the file is missing: ${missing.problems[0]}`);
    }
    const both = await run("both", { "A.md": words(20), "B.md": words(20) }, [
      { path: "A.md", max: 10 },
      { path: "B.md", max: 10 },
    ]);
    expect("every over-budget doc is reported", both.problems.length, 2);
    const nested = await run("nested", { "docs/c.md": words(3) }, [{ path: "docs/c.md", max: 3 }]);
    expect("nested path resolves", nested.problems.length + nested.counts.length, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // The committed manifest must itself be one this gate accepts.
  try {
    parseBudgets(readFileSync(path.join(REPO_ROOT, MANIFEST_REL), "utf8"));
  } catch (error) {
    failures.push(`the committed manifest is refused: ${error.message}`);
  }

  if (failures.length) {
    for (const failure of failures) console.error(`${TAG} SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `${TAG} self-test passed (word counting, manifest refusals, under, at and over the ceiling, missing file, several violations, committed manifest).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
