#!/usr/bin/env node
/**
 * Validate the front matter of every `.agents/skills/<name>/SKILL.md`.
 *
 * Why this gate exists. `.agents/skills/README.md` calls the front matter YAML
 * and tells authors to quote a value containing a colon; a consumer that parses
 * the front matter as YAML then fails to load the skill. Nothing checked that.
 * `sync-skills.mjs` mirrors bytes and would happily mirror a broken block, and
 * Prettier parses front matter without raising a YAML error - so an unquoted
 * `localModification: Adapted for dsh-auth: ...` shipped green in every gate and
 * would have failed only in the consumer that loads skills.
 *
 * This repository has `yaml` as a direct dependency (`package.json`), so the
 * block is parsed by the same library a consumer uses rather than by a
 * hand-written subset. That is the whole point: a parser this gate wrote itself
 * could accept a shape the consumer rejects, and the gate would then certify a
 * file that does not load. The reference implementation carried ~1000 lines of
 * hand-rolled YAML for a repository that had no parser available; here the
 * dependency exists, so the gate is a validator, not a parser.
 *
 * What is enforced:
 *   1. The file begins with a `---` block closed by a `---` line, and has a
 *      non-empty body after it.
 *   2. The block parses as YAML and is a mapping. A parse error is reported with
 *      the front-matter line number, not the block-relative one.
 *   3. `name` and `description` are present, non-empty strings, and `name` is
 *      lower-kebab-case and equal to the skill's directory (consumers enumerate
 *      directories).
 *   4. Provenance travels as a set: `source` and `sourceCommit` appear together,
 *      `sourceCommit` is a hex commit id, `source` is an http(s) URL, and an
 *      `origin` other than `local` carries both. `origin: local` with a
 *      `source` is refused as a contradiction.
 *   5. Every key is one the repository knows; an unknown key is refused rather
 *      than ignored, so a typo (`locModification`) is a failure and not silent
 *      data loss.
 *   6. A boolean key (`user-invocable`, `disable-model-invocation`) carries a
 *      real boolean. A quoted `"false"` reaches a consumer as a truthy string,
 *      the opposite of what the file says, so it is refused.
 *
 * Usage:
 *   node scripts/check-skill-frontmatter.mjs              # check this checkout
 *   node scripts/check-skill-frontmatter.mjs --self-test  # negative cases
 *   node scripts/check-skill-frontmatter.mjs --root <dir> # redirected run
 *
 * Exit codes: 0 clean, 1 the skills tree has problems, 2 an environment fault
 * (unreadable tree, empty tree, broken `--root`) so a fault is never misread as
 * a verdict about the tree.
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const TAG = "[check-skill-frontmatter]";

/**
 * Parse this script's arguments. An unrecognised argument is an error, never a
 * no-op: silently dropping `-root <dir>` (single-dash typo) would scan the
 * default tree and report a verdict about a tree the caller never named.
 */
function parseArgs(argv) {
  const fail = (message) => {
    console.error(`${TAG} ${message}`);
    process.exit(2);
  };
  const args = { selfTest: false, root: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--root" || arg.startsWith("--root=")) {
      if (args.root !== undefined) fail("--root given more than once");
      const value = arg === "--root" ? argv[i + 1] : arg.slice("--root=".length);
      // A transposed flag would otherwise be consumed as the value and then
      // resolved to a missing path, which exits 2 for the wrong reason.
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
  // at a real checkout cannot make the gate report green for another tree.
  const resolved = path.resolve(ARGS.root);
  let tmp;
  try {
    tmp = realpathSync(os.tmpdir());
  } catch {
    console.error(`${TAG} cannot resolve the temp directory: ${os.tmpdir()}`);
    process.exit(2);
  }
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    console.error(`${TAG} --root does not exist: ${resolved}`);
    process.exit(2);
  }
  // Containment is decided with `path.relative`, not a string prefix: on
  // Windows two spellings differing only in case name the same directory, and
  // `..` is tested together with its separator so a legitimate child whose name
  // begins with dots is not mistaken for an escape.
  const rel = path.relative(tmp, real);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    console.error(
      `${TAG} refusing --root outside the temp directory: ${real}\n` +
        "             (only --self-test may redirect this script)",
    );
    process.exit(2);
  }
  console.error(`${TAG} root override: ${real}`);
  return real;
})();

const SOURCE = path.join(ROOT, ".agents", "skills");
const SKILL_FILE = "SKILL.md";

/** Every key the repository knows. An unknown key is refused, not ignored. */
const KNOWN_KEYS = new Set([
  "name",
  "description",
  "license",
  "origin",
  "source",
  "sourceCommit",
  "localModification",
  "user-invocable",
  "disable-model-invocation",
  "allowed-tools",
]);

const REQUIRED_KEYS = ["name", "description"];

/**
 * Keys whose value is a boolean in the skill format, not a string. The
 * distinction matters because `"false"` is truthy in JavaScript: a quoted
 * boolean reaches a consumer as the opposite of what the file says.
 */
const BOOLEAN_KEYS = new Set(["user-invocable", "disable-model-invocation"]);

/** A human-readable description of a parsed YAML value, for a report. */
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a nested mapping";
  return `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Parse the front matter block and the body after it.
 *
 * @param {string} text Whole file.
 * @returns {{fields: Record<string, unknown>, body: string}}
 * @throws when the block is absent, unterminated, not YAML, or not a mapping.
 */
function parseFrontMatter(text) {
  if (text.startsWith("\uFEFF")) {
    throw new Error("a UTF-8 BOM precedes the front matter");
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error("no front matter: the first line must be exactly `---`");
  }
  const close = lines.indexOf("---", 1);
  if (close === -1) {
    throw new Error("unterminated front matter: no closing `---` line");
  }
  const block = lines.slice(1, close).join("\n");
  let fields;
  try {
    fields = parseYaml(block);
  } catch (error) {
    // The parser counts from the block's first line; the reader counts from the
    // file's. Reporting the block-relative number sends them to the wrong line.
    const first = String(error.message).split("\n")[0];
    throw new Error(
      `the front matter is not valid YAML: ${first.replace(
        /at line (\d+)/,
        (_, n) => `at front matter line ${Number(n) + 1}`,
      )}`,
    );
  }
  if (fields === null || fields === undefined) {
    throw new Error("the front matter is empty");
  }
  if (typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("the front matter must be a mapping of keys to values");
  }
  return { fields, body: lines.slice(close + 1).join("\n") };
}

/** Every problem with one skill file, in the order a reader should fix them. */
function validateSkill(dirName, text) {
  const problems = [];
  let parsed;
  try {
    parsed = parseFrontMatter(text);
  } catch (error) {
    return [error.message];
  }
  const { fields, body } = parsed;

  for (const key of REQUIRED_KEYS) {
    if (!(key in fields)) problems.push(`missing required key "${key}"`);
  }
  for (const key of Object.keys(fields)) {
    if (!KNOWN_KEYS.has(key)) {
      problems.push(
        `unknown key "${key}" - fix the typo, or add a real key to KNOWN_KEYS in scripts/check-skill-frontmatter.mjs`,
      );
    }
  }
  // A value's type is part of the contract: a consumer reads `true` as a
  // boolean and `"true"` as a string, and the two behave differently.
  for (const [key, value] of Object.entries(fields)) {
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== "boolean") {
        problems.push(
          `"${key}" is a boolean key and its value is ${describe(value)} - write \`true\` or \`false\` unquoted`,
        );
      }
    } else if (typeof value !== "string") {
      problems.push(`"${key}" must be a string, got ${describe(value)}`);
    }
  }

  const name = fields.name;
  if (typeof name === "string") {
    if (name.trim() === "") {
      problems.push(`"name" is empty`);
    } else {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
        problems.push(`"name" is ${JSON.stringify(name)}, which is not lower-kebab-case`);
      }
      if (name !== dirName) {
        problems.push(`"name" is ${JSON.stringify(name)} but the skill directory is "${dirName}"`);
      }
    }
  }
  const description = fields.description;
  if (typeof description === "string" && description.trim() === "") {
    problems.push(`"description" is empty`);
  }

  const origin = fields.origin;
  const source = fields.source;
  const commit = fields.sourceCommit;
  if ((source === undefined) !== (commit === undefined)) {
    problems.push(`"source" and "sourceCommit" travel together: state both or neither`);
  }
  if (typeof commit === "string" && !/^[0-9a-f]{7,40}$/i.test(commit)) {
    problems.push(`"sourceCommit" is ${JSON.stringify(commit)}, which is not a hex commit id`);
  }
  if (typeof source === "string" && !/^https?:\/\//.test(source)) {
    problems.push(`"source" is ${JSON.stringify(source)}, which is not an http(s) URL`);
  }
  if (origin === "local" && source !== undefined) {
    problems.push(`"origin: local" with a "source" contradicts itself: an upstream skill names it`);
  }
  if (origin !== undefined && origin !== "local" && source === undefined) {
    problems.push(`"origin: ${origin}" needs its "source" and "sourceCommit"`);
  }

  if (body.trim() === "") {
    problems.push("no body after the front matter - a skill with only front matter does nothing");
  }
  return problems;
}

/** Skill directories, or an environment fault (exit 2) if none can be read. */
async function skillDirs() {
  let entries;
  try {
    entries = await readdir(SOURCE, { withFileTypes: true });
  } catch (error) {
    console.error(`${TAG} cannot read .agents/skills: ${error.code}`);
    process.exit(2);
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  // A tree this gate cannot enumerate is an environment fault, and a tree with
  // no skill directories is one it must not call clean.
  if (dirs.length === 0) {
    console.error(`${TAG} no skill directories under .agents/skills: refusing to report green`);
    process.exit(2);
  }
  return dirs;
}

async function check() {
  const dirs = await skillDirs();
  let failures = 0;
  for (const dir of dirs) {
    const rel = `.agents/skills/${dir}/${SKILL_FILE}`;
    const abs = path.join(SOURCE, dir, SKILL_FILE);
    if (!existsSync(abs)) {
      console.error(`${TAG} FAIL ${rel}: no ${SKILL_FILE}`);
      failures += 1;
      continue;
    }
    let text;
    try {
      text = await readFile(abs, "utf8");
    } catch (error) {
      console.error(`${TAG} cannot read ${rel}: ${error.code}`);
      process.exit(2);
    }
    for (const problem of validateSkill(dir, text)) {
      console.error(`${TAG} FAIL ${rel}: ${problem}`);
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`${TAG} ${failures} problem(s) in the skills tree`);
    process.exit(1);
  }
  console.log(`${TAG} OK - ${dirs.length} skill files carry valid front matter`);
}

/**
 * Negative cases, run against throwaway trees. A gate whose rejections are
 * never exercised is a gate nobody has seen work; each case below is a shape
 * that shipped or nearly shipped.
 */
async function selfTest() {
  const { spawnSync } = await import("node:child_process");
  const failures = [];
  const script = fileURLToPath(import.meta.url);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-skill-frontmatter-selftest-"));
  const skills = path.join(tmp, ".agents", "skills");

  const reset = async () => {
    await rm(skills, { recursive: true, force: true });
    await mkdir(skills, { recursive: true });
  };
  const writeSkill = async (dir, text) => {
    await mkdir(path.join(skills, dir), { recursive: true });
    await writeFile(path.join(skills, dir, SKILL_FILE), text);
  };
  /** A skill file with the given front matter and a non-empty body. */
  const skill = (front, body = "\nBody.\n") => `---\n${front}\n---\n${body}`;
  const run = () => spawnSync(process.execPath, [script, "--root", tmp], { encoding: "utf8" });
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

  try {
    // 1. A conforming skill passes, so every case below fails for the rule under
    //    test rather than for the fixture.
    await reset();
    await writeSkill("tidy", skill("name: tidy\ndescription: Use when testing."));
    expect("clean skill", run(), 0, "OK - 1 skill files");

    // 2. A block that is not YAML is refused, and the report names the file line
    //    rather than the block-relative one.
    await reset();
    await writeSkill("tidy", skill("name: tidy\ndescription: a: b"));
    expect("invalid YAML", run(), 1, "not valid YAML");
    expect("invalid YAML names the file line", run(), 1, "front matter line 3");

    // 3. A duplicate key is a YAML error, not a silent last-wins.
    await reset();
    await writeSkill("tidy", skill("name: tidy\ndescription: one\ndescription: two"));
    expect("duplicate key", run(), 1, "not valid YAML");

    // 4. `name` must equal the directory, because consumers enumerate
    //    directories and load the skill by that name.
    await reset();
    await writeSkill("tidy", skill("name: other\ndescription: Use when testing."));
    expect("name and directory disagree", run(), 1, "but the skill directory is");

    // 5. `name` must be lower-kebab-case.
    await reset();
    await writeSkill("tidy", skill("name: Tidy_Skill\ndescription: Use when testing."));
    expect("name not kebab-case", run(), 1, "not lower-kebab-case");

    // 6. Both required keys are required.
    await reset();
    await writeSkill("tidy", skill("name: tidy"));
    expect("missing description", run(), 1, 'missing required key "description"');
    await reset();
    await writeSkill("tidy", skill("description: Use when testing."));
    expect("missing name", run(), 1, 'missing required key "name"');

    // 7. A skill with only front matter does nothing.
    await reset();
    await writeSkill("tidy", "---\nname: tidy\ndescription: Use when testing.\n---\n\n\n");
    expect("empty body", run(), 1, "no body after the front matter");

    // 8. An unknown key is a typo, not data to ignore.
    await reset();
    await writeSkill(
      "tidy",
      skill("name: tidy\ndescription: Use when testing.\nlocModification: x"),
    );
    expect("unknown key", run(), 1, 'unknown key "locModification"');

    // 9. Provenance travels as a set, and `origin: local` cannot name an
    //    upstream.
    await reset();
    await writeSkill(
      "tidy",
      skill(
        "name: tidy\ndescription: Use when testing.\norigin: local\nsource: https://e.com/s.md\nsourceCommit: 5dda764",
      ),
    );
    expect("local origin with source", run(), 1, "contradicts itself");
    await reset();
    await writeSkill(
      "tidy",
      skill("name: tidy\ndescription: Use when testing.\norigin: dsh\nsource: https://e.com/s.md"),
    );
    expect("source without commit", run(), 1, "travel together");
    await reset();
    await writeSkill(
      "tidy",
      skill(
        "name: tidy\ndescription: Use when testing.\norigin: dsh\nsource: https://e.com/s.md\nsourceCommit: ZZTOP",
      ),
    );
    expect("non-hex commit", run(), 1, "not a hex commit id");
    await reset();
    await writeSkill(
      "tidy",
      skill(
        "name: tidy\ndescription: Use when testing.\norigin: dsh\nsource: e.com/s.md\nsourceCommit: 5dda764",
      ),
    );
    expect("source not a URL", run(), 1, "not an http(s) URL");

    // 10. A boolean key carries a real boolean. A quoted one reaches a consumer
    //     as a truthy string, the opposite of what the file says.
    await reset();
    await writeSkill(
      "tidy",
      skill('name: tidy\ndescription: Use when testing.\ndisable-model-invocation: "false"'),
    );
    expect("quoted boolean", run(), 1, "is a boolean key");
    await reset();
    await writeSkill(
      "tidy",
      skill("name: tidy\ndescription: Use when testing.\ndisable-model-invocation: true"),
    );
    expect("boolean key accepted", run(), 0, "OK - 1 skill files");
    await reset();
    await writeSkill(
      "tidy",
      skill("name: tidy\ndescription: Use when testing.\nuser-invocable: 0"),
    );
    expect("boolean key with a number", run(), 1, "is a boolean key");

    // 11. A string key given a non-string is refused: `description: true` reads
    //     back as a boolean, not the sentence the author meant.
    await reset();
    await writeSkill("tidy", skill("name: tidy\ndescription: true"));
    expect("non-string description", run(), 1, "must be a string");

    // 12. Shapes that must stay accepted: a folded description, a quoted value
    //     containing a colon, and CRLF line endings.
    await reset();
    await writeSkill(
      "tidy",
      skill("name: tidy\ndescription: >\n  Use when the description is long enough\n  to wrap."),
    );
    expect("folded description", run(), 0, "OK - 1 skill files");
    await reset();
    await writeSkill(
      "tidy",
      skill("name: tidy\ndescription: Use when testing.\nlocalModification: 'Adapted: quoted'"),
    );
    expect("quoted value with colon", run(), 0, "OK - 1 skill files");
    await reset();
    await writeSkill(
      "tidy",
      "---\r\nname: tidy\r\ndescription: Use when testing.\r\n---\r\n\r\nBody.\r\n",
    );
    expect("CRLF front matter", run(), 0, "OK - 1 skill files");

    // 13. Front matter shape faults.
    await reset();
    await writeSkill("tidy", "name: tidy\ndescription: Use when testing.\n\nBody.\n");
    expect("no front matter", run(), 1, "no front matter");
    await reset();
    await writeSkill("tidy", "---\nname: tidy\ndescription: Use when testing.\n\nBody.\n");
    expect("unterminated front matter", run(), 1, "unterminated");
    await reset();
    await writeSkill(
      "tidy",
      "\uFEFF---\nname: tidy\ndescription: Use when testing.\n---\n\nBody.\n",
    );
    expect("byte order mark", run(), 1, "BOM");

    // 14. A directory without SKILL.md is a skill a consumer cannot load.
    await reset();
    await mkdir(path.join(skills, "tidy", "references"), { recursive: true });
    await writeFile(path.join(skills, "tidy", "references", "notes.md"), "not a skill\n");
    expect("directory without SKILL.md", run(), 1, "no SKILL.md");

    // 15. Environment faults are exit 2, never a verdict about the tree.
    await reset();
    await writeFile(path.join(skills, "README.md"), "no skills yet\n");
    expect("empty skills tree", run(), 2, "no skill directories");
    await rm(skills, { recursive: true, force: true });
    await writeFile(skills, "not a directory\n");
    expect("skills path is a file", run(), 2, "cannot read .agents/skills");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // The `--root` guard cases are shared by every gate script, so each copy
  // answers to one list; the defect behind them was several copies existing
  // with only one carrying an assertion.
  const spawnRoot = (args, env) =>
    spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  const { runGuardCases } = await import("./lib/guard-cases.mjs");
  await runGuardCases({ spawnRoot, failures });

  if (failures.length) {
    for (const failure of failures) console.error(`${TAG} SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `${TAG} self-test passed (front matter shape, YAML parse faults, required keys, name/directory agreement, provenance set, boolean-key values, accepted folded/quoted/CRLF shapes, unreadable and empty trees, plus shared --root guard cases).`,
  );
}

if (SELF_TEST) {
  await selfTest();
} else {
  await check();
}
