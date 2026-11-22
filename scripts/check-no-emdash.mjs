#!/usr/bin/env node
/**
 * Asserts that no em-dash character (U+2014) appears anywhere in the
 * repository's TypeScript/JavaScript source files: `src/`, `scripts/` and
 * `test/` (extensions `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`). The org style rule
 * is "do not use em-dash": use a plain ASCII hyphen instead. Run via
 * `npm run lint:no-emdash`.
 *
 * Why those roots and not the doc trees: the rule is a source-style rule, and
 * the current documentation corpus (59 files under `docs/`, 50 under
 * `.agents/`) was written before it was enforced, so scanning them here would
 * make this gate fail on a sweep that belongs to the docs owners. The roots
 * cover every file whose style this gate can fix in place without reopening
 * prose.
 *
 * Usage:
 *   node scripts/check-no-emdash.mjs              # verify; exit 1 on findings
 *   node scripts/check-no-emdash.mjs --self-test  # run the negative cases
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT), "..");

const EM_DASH = "\u2014";
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
/** The directories scanned by the checking run, relative to the repo root. */
const ROOTS = ["src", "scripts", "test"];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listCodeFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { recursive: true })) {
    const full = resolve(dir, String(entry));
    if (!CODE_EXTENSIONS.has(extname(full))) continue;
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    files.push(full);
  }
  return files;
}

/**
 * Every em-dash finding under one directory.
 *
 * @param {string} dir existing directory to walk
 * @returns {{ path: string, line: number, text: string }[]}
 */
export function findEmDashes(dir) {
  /** @type {{ path: string, line: number, text: string }[]} */
  const findings = [];
  for (const file of listCodeFiles(dir)) {
    const content = readFileSync(file, "utf8");
    if (!content.includes(EM_DASH)) continue;
    const lines = content.split("\n");
    const rel = file.slice(dir.length + 1);
    lines.forEach((line, index) => {
      if (line.includes(EM_DASH)) {
        findings.push({ path: rel, line: index + 1, text: line.trim() });
      }
    });
  }
  return findings;
}

/** Run the checking gate over ROOTS. Exits 2 on an environment fault. */
function check() {
  const missing = ROOTS.filter((root) => !existsSync(resolve(REPO_ROOT, root)));
  if (missing.length > 0) {
    console.error(
      `cannot scan: missing director${missing.length === 1 ? "y" : "ies"}: ${missing.join(", ")}`,
    );
    process.exit(2);
  }
  const findings = ROOTS.flatMap((root) =>
    findEmDashes(resolve(REPO_ROOT, root)).map((finding) => ({ ...finding, root })),
  );
  if (findings.length === 0) {
    console.log(`OK: no em-dash characters found in ${ROOTS.map((root) => `${root}/`).join(", ")}`);
    process.exit(0);
  }
  console.error("FAIL: em-dash character found (use a hyphen instead):");
  for (const finding of findings) {
    console.error(`${finding.root}/${finding.path}:${finding.line}: ${finding.text}`);
  }
  process.exit(1);
}

/**
 * Negative cases: the detector must find an em dash, accept clean input, keep
 * its extension and recursion rules, report the right line, and reject unknown
 * arguments. Fixtures live in a temporary directory, never in the repo.
 */
function selfTest() {
  /** @type {string[]} */
  const failures = [];
  /**
   * @param {boolean} condition
   * @param {string} label
   */
  const expect = (condition, label) => {
    if (!condition) failures.push(label);
  };
  const root = mkdtempSync(join(tmpdir(), "no-emdash-"));
  try {
    /**
     * @param {string} rel
     * @param {string} content
     */
    const write = (rel, content) => {
      const file = join(root, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    };

    // Positive: an em dash is found, at the right line, in a nested file.
    write("nested/dirty.ts", `const a = 1;\nconst b = 2; // bad ${EM_DASH} dash\n`);
    const dirty = findEmDashes(root);
    expect(dirty.length === 1, `one finding expected, got ${dirty.length}`);
    expect(dirty[0]?.path === join("nested", "dirty.ts"), "finding path keeps the nested layout");
    expect(dirty[0]?.line === 2, "finding reports the line carrying the em dash");
    expect(dirty[0]?.text.includes(EM_DASH) === true, "finding text is the offending line");

    // Two em dashes on separate lines are two findings.
    write("nested/two.ts", `${EM_DASH}\n${EM_DASH}\n`);
    expect(findEmDashes(root).length === 3, "each em-dash line is its own finding");

    // Negative: a clean tree has no finding.
    rmSync(join(root, "nested"), { recursive: true, force: true });
    write("clean.ts", "const a = 1;\n");
    expect(findEmDashes(root).length === 0, "clean source has no finding");

    // Extension rule: a non-code file cannot trip the gate.
    write("README.md", `prose ${EM_DASH} with a dash\n`);
    write("data.json", `{ "note": "x ${EM_DASH} y" }\n`);
    expect(findEmDashes(root).length === 0, "non-code extensions are out of scope");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // The CLI refuses an unknown argument instead of pretending it checked.
  /** @param {string[]} args */
  const spawn = (args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: REPO_ROOT });
  expect(spawn(["--bogus"]).status === 2, "an unknown argument exits 2");

  if (failures.length > 0) {
    for (const failure of failures) console.error(`SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    "OK: no-emdash self-test passed (detection, clean tree, extension and recursion rules, line reporting, argument guard)",
  );
}

function main() {
  const args = process.argv.slice(2);
  const selfTestMode = args.includes("--self-test");
  const unknown = args.filter((arg) => arg !== "--self-test");
  if (unknown.length > 0) {
    console.error(`unknown argument: ${unknown[0]}`);
    process.exit(2);
  }
  if (selfTestMode) selfTest();
  else check();
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) main();
