#!/usr/bin/env node
/**
 * Bilingual pair consistency check (zero-dependency, mirrors the DSH
 * .i18n.yaml sidecar mechanism).
 *
 * Convention (copied from deepseek-harness): a bilingual document is a
 * triplet of sibling files - English `foo.md`, Chinese `foo.zh.md`, and a
 * consistency record `foo.i18n.yaml` holding the git blob hash of each side
 * as of the last confirmed-consistent state.
 *
 *   # Bilingual-pair consistency record: the git blob hash of each side as
 *   # of the last confirmed-consistent state. Both languages carry equal
 *   # authority; after editing either side, bring the other along and
 *   # re-record with:  npm run bilingual:re-record -- <stem>
 *   foo.md: 40-hex-hash
 *   foo.zh.md: 40-hex-hash
 *
 * Checks:
 *   1. Every non-exempt in-scope `foo.md` has a `foo.zh.md` + `foo.i18n.yaml`.
 *   2. The hashes in each record match `git hash-object` of the current files
 *      (i.e. nobody edited one side without re-confirming the pair).
 *   3. No orphan `.zh.md` / `.i18n.yaml` without its English sibling.
 *   4. Exempt files never carry a `.zh.md` or `.i18n.yaml` sibling.
 *   5. Pair shape: each side carries a language-switcher link to its sibling
 *      in its header (a self-link or a missing link fails).
 *   6. Pair shape: both sides have the same heading-level sequence, so a
 *      section dropped from one translation is caught.
 *   7. Pair shape: each side ends with exactly one newline.
 *   8. Structural signature (scripts/lib/md-signature.mjs): the same fenced
 *      code blocks byte for byte, the same table dimensions, the same lists in
 *      the same order with the same item counts, and the same link targets once
 *      each side's locale is projected away. The Chinese side links the
 *      `.zh.md` counterpart of an in-corpus target, the English side the `.md`
 *      one; a target outside the corpus keeps its authored path.
 *
 * Checks 5-7 exist because these defects shipped once and no other gate
 * covers them (Prettier skips docs/, and a stale sidecar or a self-linked
 * language line is invisible to review). Check 8 exists because a translation
 * silently drops a code block, a table row, or a list item while every prose
 * gate stays green; its own limits are stated in the module it lives in.
 *
 * `--write` also pins each recorded blob under refs/bilingual-pairing/
 * snapshots/<hash> (see storeBlob), because an unreferenced blob a bare
 * `git hash-object -w` writes is exactly what `git gc` prunes - confirmed
 * directly: one `git gc --prune=now` on an unreferenced blob is enough to
 * make it `fatal: Not a valid object name`. This is local-only: the ref
 * namespace is not `refs/heads/` or `refs/tags/`, so an ordinary `git push`
 * never sends it, and a fresh clone starts without it. gen-zh-brief's "read
 * the last confirmed text back through the recorded hash" only benefits from
 * the pin on a checkout where `--write` actually ran.
 *
 * Usage:
 *   node scripts/check-bilingual.mjs            # exit 1 on violations
 *   node scripts/check-bilingual.mjs --write <stem>   # re-record one pair
 *   node scripts/check-bilingual.mjs --write --all    # re-record every pair
 *   node scripts/check-bilingual.mjs --write <stem> --force  # override every
 *     blocking problem for that pair, checks 5-8 included; the escape hatch,
 *     not the ordinary path
 *   node scripts/check-bilingual.mjs --pair <stem>  # re-check the named pair
 *     only, so an update loop verifies its own pair in a second instead of
 *     re-reading the corpus
 *   node scripts/check-bilingual.mjs --status       # report every pair's state
 *     worst-first and never fail; the corpus-wide gate is what fails
 *
 * A `--write` run first re-applies checks 1-8 and refuses to record a pair
 * whose structure is broken. Stale hashes (check 2) are the one problem it
 * accepts, because accepting them is what re-recording means.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { headingDepths, indexFences, structuralProblems } from "./lib/md-signature.mjs";

/**
 * Parse this script's arguments once. Every recognised flag is consumed; what
 * is left is a pair anchor (a path or bare stem), which only makes sense with
 * `--write`. Treating an unrecognised flag as an anchor is what let a
 * misspelled `-root` be silently accepted as a pair name.
 */
const ARGS = (() => {
  const argv = process.argv.slice(2);
  const parsed = {
    write: false,
    all: false,
    force: false,
    selfTest: false,
    status: false,
    root: undefined,
    base: undefined,
  };
  const anchors = [];
  const pairs = [];
  const fail = (message) => {
    console.error(`[check-bilingual] ${message}`);
    process.exit(2);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") parsed.write = true;
    else if (arg === "--all") parsed.all = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--self-test") parsed.selfTest = true;
    else if (arg === "--status") parsed.status = true;
    else if (arg === "--pair" || arg.startsWith("--pair=")) {
      const value = arg === "--pair" ? argv[i + 1] : arg.slice("--pair=".length);
      if (!value || value.startsWith("--")) fail("--pair needs a document path or stem");
      pairs.push(value.replace(/\.(zh\.md|i18n\.yaml|md)$/, ""));
      if (arg === "--pair") i += 1;
    } else if (arg === "--base" || arg.startsWith("--base=")) {
      if (parsed.base !== undefined) fail("--base given more than once");
      const value = arg === "--base" ? argv[i + 1] : arg.slice("--base=".length);
      if (!value || value.startsWith("--")) fail("--base needs a git ref");
      parsed.base = value;
      if (arg === "--base") i += 1;
    } else if (arg === "--root" || arg.startsWith("--root=")) {
      if (parsed.root !== undefined) fail("--root given more than once");
      const value = arg === "--root" ? argv[i + 1] : arg.slice("--root=".length);
      // A transposed flag would be consumed as the value and then resolved to a
      // missing path, which exits 2 for the wrong reason.
      if (!value || value.startsWith("--")) fail("--root needs a directory value");
      parsed.root = value;
      if (arg === "--root") i += 1;
    } else if (arg.startsWith("-")) fail(`unknown argument: ${arg}`);
    else anchors.push(arg);
  }
  parsed.anchors = anchors;
  parsed.pairs = pairs;
  if (parsed.write && parsed.pairs.length)
    fail("--pair and --write are separate modes; a scoped write is `--write <stem>`");
  if (
    parsed.status &&
    (parsed.write || parsed.all || parsed.force || parsed.pairs.length || anchors.length)
  ) {
    fail("--status reports the whole corpus and takes no other arguments");
  }
  return parsed;
})();

const ROOT = (() => {
  if (ARGS.root === undefined) {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  }
  // Same guard as the other gates: an override may only point inside the system
  // temp directory, so one aimed at a real checkout cannot make this gate
  // rewrite another tree's sidecars. Containment is decided on resolved paths
  // with `path.relative`, not a string prefix, because on Windows two spellings
  // differing only in case name the same directory.
  const resolved = path.resolve(ARGS.root);
  let tmp;
  try {
    tmp = realpathSync(os.tmpdir());
  } catch {
    // An unresolvable temp directory is an environment fault, not a verdict on
    // the tree. It keeps its own catch and its own message: sharing one with
    // the `--root` resolution made a broken `TMPDIR` report
    // `--root does not exist: /tmp`, which sends the reader after a path that
    // is not the broken one.
    console.error(`[check-bilingual] cannot resolve the temp directory: ${os.tmpdir()}`);
    process.exit(2);
  }
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    console.error(`[check-bilingual] --root does not exist: ${resolved}`);
    process.exit(2);
  }
  const rel = path.relative(tmp, real);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    console.error(`[check-bilingual] refusing --root outside the temp directory: ${real}`);
    process.exit(2);
  }
  console.error(`[check-bilingual] root override: ${real}`);
  return real;
})();

/**
 * Bilingual coverage is the whole committed Markdown corpus, minus files that
 * are agent-facing instructions rather than documentation:
 *
 *   - `AGENTS.md` and `CLAUDE.md`: the instruction entry points, English by
 *     their own contract (the same exclusion the upstream notes tree makes).
 *   - `.agents/skills/**`: skill definitions, a single source of truth that
 *     mirrors into the generated `.claude/skills/` tree.
 *   - `SELF_BILINGUAL`: documents that carry both languages in one file, so a
 *     `.zh.md` counterpart would duplicate them.
 *
 * The previous rule was the reverse, an opt-in list of `docs/`,
 * `.agents/notes/` and one hardcoded root file, which meant a new document
 * anywhere else carried no counterpart and no gate noticed. The corpus is
 * enumerated from git rather than by walking directories, so build output,
 * dependency trees and local drafts are out of scope by construction instead
 * of by a hand-maintained exclusion list.
 */
const EXCLUDED = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  // release-please generates it; there is no Chinese side to keep in step.
  "CHANGELOG.md",
]);

/**
 * Bilingual by construction: the terminology table pairs an English column
 * with a Chinese one on every row, and the style samples are an English
 * paragraph immediately followed by its approved Chinese rendering. Both are
 * read in one place, in both languages, so pairing them would mean writing the
 * Chinese twice - and a machine check would then have to decide which copy is
 * authoritative. The upstream dsh i18n tree excludes its equivalents for the
 * same reason.
 */
const SELF_BILINGUAL = new Set(["docs/i18n/terminology.md", "docs/i18n/style-samples.md"]);

/**
 * Pairs whose two sides already disagreed structurally before this gate landed.
 * They are reported as `known drift` and do not fail the run, so the gate can be
 * blocking for every other pair without this change also rewriting four long
 * documents. The rules are not relaxed: a new document, and any new edit to a
 * pair, is held to all eight checks. Three constraints keep the list from
 * becoming a place to park a defect:
 *
 *   1. **It may only shrink.** A listed pair whose two sides now agree is
 *      itself a failure, reported as "remove the entry" (see the check after
 *      the main loop). Adding an entry to silence a new defect therefore fails
 *      the gate on the next run that finds the pair clean.
 *   2. **It applies to the real checkout only.** A `--root` fixture is a
 *      different tree, and holding it to this repository's backlog would make
 *      every fixture case fail for a reason it is not testing.
 *   3. **It is never silent.** Every run prints the count and each drifted
 *      message, so the debt is visible in the output rather than swallowed.
 */
/**
 * The recorded backlog. `--base <ref>` compares this list with the one at that
 * ref: an entry added since the base fails, so the list cannot grow to cover a
 * new defect. The list is also checked against the tree (an entry whose pair is
 * now clean fails), so it cannot stay stale either.
 */
const KNOWN_DRIFT = new Set([
  "README.md",
  "docs/deployed/deployment.md",
  "docs/deployed/local-proxy.md",
  "docs/deployed/reverse-proxy.md",
  ".agents/notes/implemented/feature/2026-09-22-public-host-identity.md",
]);

/**
 * The repository uses three naming conventions for a Chinese counterpart, and
 * this gate reads all three rather than forcing one:
 *
 *   docs/foo.md        + docs/foo_zh.md        (the docs/ corpus)
 *   docs/foo.en.md     + docs/foo.zh.md        (the legacy ADR naming)
 *   README.md          + README.zh.md          (the root READMEs)
 *   .agents/notes/x.md + .agents/notes/x.zh.md (the note tree)
 *
 * `localeOf(rel)` answers which side a path is; `counterpart(rel)` returns the
 * other side's path. A path with no counterpart returns undefined, which is what
 * keeps an unpaired target an authored path on either side.
 */
const ZH_SUFFIXES = ["_zh.md", ".zh.md"];

/** @returns {{locale: "en"|"zh", key: string} | undefined} */
function localeOf(rel) {
  for (const suffix of ZH_SUFFIXES) {
    if (rel.endsWith(suffix)) {
      return { locale: "zh", key: rel.slice(0, -suffix.length) + ".md" };
    }
  }
  if (rel.endsWith(".md")) return { locale: "en", key: rel };
  return undefined;
}

/** The other side's path for a paired document, or undefined. */
function counterpart(rel) {
  const info = localeOf(rel);
  if (info === undefined) return undefined;
  if (info.locale === "zh") return info.key;
  for (const suffix of ZH_SUFFIXES) {
    const candidate = rel.slice(0, -3) + suffix;
    if (existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return undefined;
}

/**
 * The projection the structural signature needs: a repository-relative path to
 * its pair identity and locale. Returns undefined for a path with no
 * counterpart, so an unpaired target stays an authored path.
 */
function pairedLocale(rel) {
  const info = localeOf(rel);
  if (info === undefined) return undefined;
  const other = counterpart(rel);
  if (other === undefined) return undefined;
  return {
    key: info.key,
    locale: info.locale,
    paths: { en: info.locale === "en" ? rel : other, zh: info.locale === "zh" ? rel : other },
  };
}

/**
 * The KNOWN_DRIFT entries recorded at `ref`.
 *
 * Returns a Set on success. Throws when the ref cannot be read or the list
 * cannot be found in it: a caller that asked for a baseline and did not get one
 * must not be told the list was compared. The one case that returns null is "no
 * baseline was asked for", which is a fixture tree, not a verdict.
 */
function readKnownDriftAt(ref) {
  const text = execFileSync("git", ["-C", ROOT, "show", `${ref}:scripts/check-bilingual.mjs`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const start = text.indexOf("const KNOWN_DRIFT = new Set([");
  if (start === -1) {
    throw new Error(`${ref}:scripts/check-bilingual.mjs has no KNOWN_DRIFT list`);
  }
  const end = text.indexOf("]);", start);
  if (end === -1) {
    throw new Error(`${ref}:scripts/check-bilingual.mjs has an unterminated KNOWN_DRIFT list`);
  }
  const entries = new Set();
  for (const m of text.slice(start, end).matchAll(/"([^"]+)"/g)) entries.add(m[1]);
  return entries;
}

function isExcluded(rel) {
  if (EXCLUDED.has(rel)) return true;
  if (SELF_BILINGUAL.has(rel)) return true;
  if (rel.startsWith(".agents/skills/")) return true;
  // Lifecycle placeholder files inside the notes tree, not notes.
  if (rel.startsWith(".agents/notes/") && path.basename(rel) === "AGENTS.md") return true;
  // The frozen historical area keeps whatever pairing it had. Re-translating a
  // frozen record, or giving it a sidecar, would edit the record; the seal in
  // check-archives.mjs is what protects it instead.
  if (rel.startsWith("docs/history/")) return true;
  // Design exports and demo assets are not prose.
  if (rel.startsWith("docs/design/") || rel.startsWith("docs/demo/")) return true;
  // Tool configuration, not documentation.
  if (rel.startsWith(".rsp/")) return true;
  // The prose rules are a single-language page: it describes how to write
  // Chinese, so a Chinese twin would restate the same rules in the language
  // they govern. The terminology table is the same shape.
  if (rel === "docs/i18n/prose-rules.md") return true;
  return false;
}

/**
 * The corpus: every Markdown-ish file git knows about, tracked or not.
 *
 * Two sources, and the difference between "listed nothing" and "could not
 * list" is the point: a `git ls-files` failure (a `--root` fixture that is not
 * a checkout, no `git` on `PATH`, a `GIT_DIR` pointing elsewhere) is an
 * environment fault, while `git` succeeding on a tree that genuinely holds no
 * Markdown is a real empty set. Collapsing the two is how this gate printed
 * `Bilingual check passed.` for a tree it had never read.
 */
function collectCorpus() {
  // `null` marks a failed enumeration; `[]` a successful empty one.
  let listed = null;
  try {
    // Tracked files *and* untracked-but-not-ignored ones. The untracked half is
    // what makes the gate usable on the change that introduces a document: a
    // new file has no counterpart and no record yet, and `git ls-files` alone
    // does not see it, so the author's own gate would stay green until the
    // commit while CI went red afterwards. Ignored paths (build output,
    // dependency trees, gitignored local drafts) stay out.
    listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // A `--root` fixture is not a checkout; silence git's "not a git
      // repository" on stderr so the fault is reported once, by the check
      // below, rather than twice.
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
  // A fixture is not a checkout, so its corpus arrives on stdin; that is the
  // supported mode, and a non-empty list is the only thing that may stand in
  // for a failed enumeration. With neither there is no corpus to judge, and
  // `passed` would be a verdict about a tree this gate never opened.
  if (listed === null && piped.length === 0) {
    console.error(
      "[check-bilingual] cannot enumerate the corpus: `git ls-files` failed and no file list was piped on stdin",
    );
    process.exit(2);
  }
  const all = new Set([...(listed ?? []), ...piped]);
  return [...all].map((p) => p.split(path.sep).join("/")).sort();
}

const CORPUS = collectCorpus();

/**
 * `--pair <stem>` narrows reporting to the named documents, so an update loop
 * verifies its own pair without re-reading the corpus. A name that is not in
 * scope is a usage fault rather than a clean run: reporting green for a
 * document this gate never opened is the failure mode the guard exists for.
 */
const SCOPED = (() => {
  if (!ARGS.pairs.length) return null;
  const corpus = new Set(CORPUS);
  for (const stem of ARGS.pairs) {
    const en = `${stem}.md`;
    if (!corpus.has(en)) {
      console.error(`[check-bilingual] --pair names a document outside the corpus: ${en}`);
      process.exit(2);
    }
    if (isExcluded(en) || SELF_BILINGUAL.has(en)) {
      console.error(`[check-bilingual] --pair names an excluded document: ${en}`);
      process.exit(2);
    }
  }
  return new Set(ARGS.pairs.map((stem) => `${stem}.md`));
})();

// Point `git` at the scanned tree: `--root` redirects which `.i18n.yaml` the
// gate rewrites, and a hash taken with the wrong cwd would certify the hash of
// a same-named file somewhere else.
function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function blobHash(abs) {
  return git(["hash-object", abs]).trim();
}

/**
 * A ref namespace that exists for one reason: keep every blob `storeBlob`
 * writes reachable, so `git gc` never prunes it. `git hash-object -w` puts a
 * blob in the object database, but a loose object nothing points to is
 * exactly what `git gc --prune=now` deletes - confirmed directly: a blob
 * written this way and never referenced anywhere else becomes
 * `fatal: Not a valid object name` after one `git gc --prune=now`, in as
 * little as the default ~2-week grace period on an ordinary `git gc`. This
 * mirrors the ref namespace DSH (deepseek-harness) keeps for the same
 * mechanism (`refs/dsh/translation-pairing/snapshots/<hash>`).
 */
const SNAPSHOT_REF_PREFIX = "refs/bilingual-pairing/snapshots/";

/**
 * Hash a file and store the blob in the object database, so the recorded hash
 * can be turned back into text (`git cat-file blob <hash>`). `gen-zh-brief`
 * reads the last confirmed English text through that pointer, which is what
 * makes a minimal update possible at all.
 *
 * A `--root` fixture is not a checkout and has no object database; there the
 * hash is computed without storing it. Both paths return the same hash, so the
 * record is identical either way and only recoverability differs.
 */
function storeBlob(abs) {
  let hash;
  try {
    hash = git(["hash-object", "-w", abs]).trim();
  } catch {
    return blobHash(abs);
  }
  try {
    // Pin the blob against gc. A failure here (a read-only .git, a
    // pre-2.x git) is not a reason to fail the write: the hash is already
    // recorded and still correct, only the extra durability is lost, so
    // this stays best-effort and silent rather than turning a successful
    // record into a failed one.
    git(["update-ref", `${SNAPSHOT_REF_PREFIX}${hash}`, hash]);
  } catch {
    // Best-effort; see above.
  }
  return hash;
}

function relOf(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function readRecord(enAbs) {
  // enAbs is the English file's absolute path (…/foo.md); the record lives
  // beside it as foo.i18n.yaml (strip the .md extension).
  const p = enAbs.replace(/\.md$/, "") + ".i18n.yaml";
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  const hashes = {};
  for (const line of text.split("\n")) {
    const m = /^([\w./-]+\.md):\s*([0-9a-f]{40})\s*$/.exec(line.trim());
    if (m) hashes[m[1]] = m[2];
  }
  return hashes;
}

function writeRecord(stemRel) {
  // stemRel is the English file WITHOUT extension, e.g. "docs/onboarding".
  const enRel = `${stemRel}.md`;
  const zhRel = counterpart(enRel);
  if (zhRel === undefined) {
    console.error(`[check-bilingual] ${enRel} has no Chinese counterpart to record`);
    process.exit(2);
  }
  const enAbs = path.join(ROOT, enRel);
  const zhAbs = path.join(ROOT, zhRel);
  const enHash = storeBlob(enAbs);
  const zhHash = storeBlob(zhAbs);
  const enKey = path.basename(enRel);
  const zhKey = path.basename(zhRel);
  const content = `# Bilingual-pair consistency record: the git blob hash of each side as
# of the last confirmed-consistent state. Both languages carry equal
# authority; after editing either side, bring the other along and re-record
# with:  npm run bilingual:re-record -- ${stemRel}
${enKey}: ${enHash}
${zhKey}: ${zhHash}
`;
  const out = path.join(ROOT, `${stemRel}.i18n.yaml`);
  writeFileSync(out, content);
  console.log(`re-recorded ${path.relative(ROOT, out)}`);
}

/**
 * `--status` prints every pair's state, worst first, and never fails. The
 * corpus-wide run answers "is anything wrong"; this answers "what is", with the
 * document to open and the command that fixes it. It reports completeness and
 * recorded hashes only - the structural rules need both sides read, which is
 * what the ordinary run does.
 */
function reportStatus() {
  const rows = [];
  for (const rel of CORPUS) {
    const base = path.basename(rel);
    if (!base.endsWith(".md") || base.endsWith(".zh.md")) continue;
    if (isExcluded(rel) || SELF_BILINGUAL.has(rel)) continue;
    const zhRel = counterpart(rel);
    if (!existsSync(path.join(ROOT, zhRel))) {
      rows.push({ state: "missing", rel, detail: `no ${zhRel}` });
      continue;
    }
    const record = readRecord(path.join(ROOT, rel));
    if (!record) {
      rows.push({
        state: "unrecorded",
        rel,
        detail: `run bilingual:re-record -- ${rel.slice(0, -3)}`,
      });
      continue;
    }
    const enBase = path.basename(rel);
    const zhBase = path.basename(zhRel);
    if (!(enBase in record) || !(zhBase in record)) {
      rows.push({
        state: "malformed",
        rel,
        detail: `expected keys \`${enBase}\` and \`${zhBase}\``,
      });
      continue;
    }
    const enStale = record[enBase] !== blobHash(path.join(ROOT, rel));
    const zhStale = record[zhBase] !== blobHash(path.join(ROOT, zhRel));
    if (enStale || zhStale) {
      const sides = enStale && zhStale ? "both sides" : enStale ? "English side" : "Chinese side";
      rows.push({
        state: "out-of-sync",
        rel,
        detail: `${sides} changed since the last confirmed state - re-record -- ${rel.slice(0, -3)}`,
      });
      continue;
    }
    rows.push({ state: "ok", rel, detail: "" });
  }
  const order = { missing: 0, malformed: 1, unrecorded: 2, "out-of-sync": 3, ok: 4 };
  rows.sort((a, b) => order[a.state] - order[b.state] || a.rel.localeCompare(b.rel));
  for (const row of rows) {
    console.log(`${row.state.padEnd(11)} ${row.rel}${row.detail ? ` - ${row.detail}` : ""}`);
  }
  const counts = {};
  for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
  const summary = Object.keys(order)
    .filter((state) => counts[state])
    .map((state) => `${counts[state]} ${state}`)
    .join(", ");
  console.log(`\n${rows.length} pair(s) in scope: ${summary}`);
}

async function main() {
  if (ARGS.status) {
    reportStatus();
    return;
  }
  const writeMode = ARGS.write;
  const allMode = ARGS.all;
  const forceMode = ARGS.force;
  const anchors = ARGS.anchors;
  if (writeMode && allMode && anchors.length > 0) {
    console.error("--write --all takes no anchors");
    process.exit(2);
  }
  if (!writeMode && (allMode || anchors.length > 0)) {
    console.error("anchors/--all only apply with --write");
    process.exit(2);
  }
  // `--force` exists to re-record a pair whose recorded confirmations are stale
  // *and* say so; it is not a way to record a pair that is structurally broken.
  if (!writeMode && forceMode) {
    console.error("--force only applies with --write");
    process.exit(2);
  }
  const problems = [];
  /**
   * Record a problem, honouring `--pair`: a scoped run reports only messages
   * that name one of the named pairs, so an unrelated document's drift cannot
   * make the caller's own loop red. Every message below starts with the path of
   * the side it is about.
   */
  const knownDrift = [];
  /**
   * The pair a message is about, as the English side's path. Every message
   * starts with the path of the side it is about, and a Chinese side maps back
   * through `localeOf`.
   */
  const pairOf = (message) => {
    const rel = message.slice(0, message.indexOf(":"));
    return localeOf(rel)?.key ?? rel;
  };
  const report = (message) => {
    if (SCOPED) {
      const named = [...SCOPED].some(
        (rel) => message.startsWith(`${rel}:`) || message.startsWith(`${rel.slice(0, -3)}.zh.md:`),
      );
      if (!named) return;
    }
    // A pair on the known-drift list is reported but does not fail: its two
    // sides disagreed before this gate existed, and clearing that is a separate
    // change. The list may only shrink - see the check after the loop.
    if (KNOWN_DRIFT.has(pairOf(message))) {
      knownDrift.push(message);
      return;
    }
    problems.push(message);
  };
  /**
   * The subset of `problems` that recording is meant to resolve: a stale
   * record, or one that does not exist yet because the pair is new. `--write`
   * accepts these and refuses the rest - a switcher that does not link its
   * sibling, a heading sequence that dropped a section, an orphan, a missing
   * counterpart. Stamping a pair as confirmed-consistent while the gate already
   * knows it is broken is the defect this refusal exists to close.
   */
  const recordable = [];

  // Split the corpus into the three artifact kinds. `zhMd` and `sidecars` are
  // keyed by path so an orphan (a `.zh.md` or `.i18n.yaml` with no English
  // sibling) is detectable, which is how a half-created pair is caught.
  const englishMd = [];
  const zhMd = new Map(); // rel -> abs
  const sidecars = new Set();
  for (const rel of CORPUS) {
    const abs = path.join(ROOT, rel);
    const base = path.basename(rel);
    // `CORPUS` is the whole git-known tree, not just the Markdown-ish subset
    // this gate classifies below: a `.ts` or `.png` deleted from the working
    // copy without staging the deletion is still `git ls-files`-listed and
    // absent on disk, and is none of this gate's business. Checking existence
    // before deciding whether a file is one of the three artifact kinds this
    // gate pairs made every such file the gate's problem; the check now runs
    // only for the kinds it would otherwise classify.
    const isPairKind = base.endsWith(".i18n.yaml") || base.endsWith(".md");
    if (!isPairKind) continue;
    // Named by the corpus but absent on disk. Skipping it silently hides
    // whatever pair sat behind it, so the discrepancy is reported: a listed
    // file the gate cannot open is exactly the kind of gap this gate exists to
    // make visible.
    if (!existsSync(abs)) {
      report(`${rel}: listed in the corpus but missing on disk`);
      continue;
    }
    if (base.endsWith(".i18n.yaml")) sidecars.add(rel);
    else if (localeOf(rel)?.locale === "zh") zhMd.set(rel, abs);
    else if (base.endsWith(".md")) englishMd.push({ rel, abs });
  }

  // Normalize: English file = foo.md. Find orphans.
  for (const { rel, abs } of englishMd) {
    if (isExcluded(rel)) {
      // An excluded file must not carry a pair: a `.zh.md` or sidecar beside it
      // would be a document the corpus never checks.
      // The frozen historical area keeps whatever pairing it had: a pair there
      // is expected, not a defect. Every other exclusion is a file that must not
      // carry one, because a pair beside it would be a document nothing checks.
      if (!rel.startsWith("docs/history/")) {
        const other = counterpart(rel);
        if (other !== undefined && zhMd.has(other))
          report(`${rel}: excluded from pairing but ${other} exists`);
      }
      if (sidecars.has(`${rel.slice(0, -3)}.i18n.yaml`))
        report(`${rel}: excluded from pairing but a .i18n.yaml exists`);
      continue;
    }
    const zhRel = counterpart(rel);
    const hasZh = zhRel !== undefined && existsSync(path.join(ROOT, zhRel));
    // A missing counterpart is reported first and on its own: the record and
    // shape rules describe a pair, and there is no pair to describe yet. The
    // rest of the checks still run, so one pass reports everything wrong rather
    // than one thing at a time.
    if (!hasZh) {
      report(`${rel}: missing Chinese counterpart ${zhRel} - every in-scope doc must be bilingual`);
    }
    const record = readRecord(abs);
    if (hasZh) {
      const enBase = path.basename(rel);
      const zhBase = path.basename(zhRel);
      if (!record) {
        const message = `${rel}: missing consistency record ${rel.slice(0, -3)}.i18n.yaml - run bilingual:re-record`;
        report(message);
        // A pair that has never been recorded is not a broken pair: creating the
        // record is the whole job of the first re-record, so `--write` accepts it
        // exactly as it accepts a stale one. Everything else it still refuses.
        recordable.push(message);
      } else if (!(enBase in record) || !(zhBase in record)) {
        report(`${rel}: malformed record - expected keys \`${enBase}\` and \`${zhBase}\``);
      } else {
        const enNow = blobHash(abs);
        const zhNow = blobHash(path.join(ROOT, zhRel));
        if (record[enBase] !== enNow) {
          const message = `${rel}: English side changed since last confirmed state - bring the Chinese side along, then re-record (bilingual:re-record -- ${rel.slice(0, -3)})`;
          report(message);
          recordable.push(message);
        }
        if (record[zhBase] !== zhNow) {
          const message = `${zhRel}: Chinese side changed since last confirmed state - bring the English side along, then re-record (bilingual:re-record -- ${rel.slice(0, -3)})`;
          report(message);
          recordable.push(message);
        }
      }
    }

    // The record checks must not skip the structural ones: a pair with no record
    // yet is exactly the pair a first `--write` is about to stamp, so it needs
    // the switcher, heading and newline rules applied before it is recorded.
    // `continue` here once meant a never-recorded broken pair was recorded as
    // confirmed-consistent, which is the defect the refusal exists to close.

    // 5. Language-switcher links in the header: each side must link its
    // sibling's *file* (a self-link, a missing link, or a link that merely
    // shares the sibling's basename - e.g. `.agents/notes/README.md` in
    // README.zh.md - all fail). Resolve each target against the linking
    // file's directory and compare real paths rather than matching text.
    // A document with no counterpart has nothing to switch to, so these rules
    // describe a pair that does not exist yet and are skipped; the missing
    // counterpart is already reported above.
    if (!hasZh) continue;
    const enText = await readFile(abs, "utf8");
    const zhAbs = path.join(ROOT, zhRel);
    const zhText = await readFile(zhAbs, "utf8");
    const headerEn = enText.slice(0, Math.min(enText.length, 1600));
    const headerZh = zhText.slice(0, Math.min(zhText.length, 1600));
    const resolvesTo = (text, fromDir, target) =>
      [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].some((m) => {
        const raw = m[1].split("#")[0];
        if (!raw || /^(https?:)?\/\//.test(raw)) return false;
        return path.resolve(fromDir, raw) === target;
      });
    if (!resolvesTo(headerEn, path.dirname(abs), zhAbs)) {
      report(
        `${rel}: English header must link its Chinese sibling \`${path.basename(zhRel)}\` (language-switcher line is missing or points at the wrong file)`,
      );
    }
    if (!resolvesTo(headerZh, path.dirname(zhAbs), abs)) {
      report(
        `${zhRel}: Chinese header must link its English sibling \`${path.basename(rel)}\` (language-switcher line is missing or points at the wrong file)`,
      );
    }

    // 6. Heading-level parity: the sequence of heading depths must match.
    // Headings inside fenced code blocks are ignored, so a `#` comment in a
    // shell snippet cannot be mistaken for a section. The parser is the
    // signature module's: a second copy here closed a fence without the
    // length test, so a nested block could expose a heading the signature
    // never saw.
    const enHeads = headingDepths(enText);
    const zhHeads = headingDepths(zhText);
    if (enHeads.join(",") !== zhHeads.join(",")) {
      report(
        `${rel}: heading levels differ from ${zhRel} (en=${enHeads.join(",")} zh=${zhHeads.join(",")}) - a section may be missing on one side`,
      );
    }

    // 7. Exactly one trailing newline on each side.
    if (!enText.endsWith("\n")) {
      report(`${rel}: must end with a single newline (.editorconfig insert_final_newline)`);
    } else if (enText.endsWith("\n\n")) {
      report(`${rel}: ends with more than one newline - trim to exactly one`);
    }
    if (!zhText.endsWith("\n")) {
      report(`${zhRel}: must end with a single newline (.editorconfig insert_final_newline)`);
    } else if (zhText.endsWith("\n\n")) {
      report(`${zhRel}: ends with more than one newline - trim to exactly one`);
    }

    // 8. Structural signature: the frame a translation must preserve. The rules
    //    and their limits live in scripts/lib/md-signature.mjs; this gate only
    //    reports what that module finds.
    for (const problem of structuralProblems({
      enText,
      zhText,
      enRel: rel,
      zhRel,
      pairedLocale,
    })) {
      report(problem);
    }
  }

  // Orphan .zh.md without English sibling.
  for (const [rel] of zhMd) {
    const enRel = rel.slice(0, -6) + ".md";
    if (!englishMd.some((e) => e.rel === enRel)) {
      report(`${rel}: Chinese counterpart without an English sibling`);
    }
  }

  if (writeMode) {
    const blocking = problems.filter((p) => !recordable.includes(p));
    if (blocking.length && !forceMode) {
      console.error("Bilingual re-record refused - fix these first:");
      for (const p of blocking) console.error(`  - ${p}`);
      console.error(
        "Re-recording accepts a stale record (that is what it is for); it does not stamp a pair the gate knows is structurally broken.",
      );
      process.exit(1);
    }
    const targets = allMode
      ? englishMd.filter(({ rel }) => !isExcluded(rel)).map(({ rel }) => rel.slice(0, -3))
      : anchors.map((a) => a.replace(/\.(md|zh\.md|i18n\.yaml)$/, ""));
    // A `--write` with nothing named has no pair to confirm; recording nothing
    // and exiting 0 would read as "the pair is fine".
    if (!targets.length) {
      console.error(
        "[check-bilingual] --write needs the pairs you confirmed: name them, or pass --all for a corpus-wide re-record",
      );
      process.exit(2);
    }
    for (const t of targets) writeRecord(t);
    return;
  }

  // The known-drift list may only shrink. A listed pair that is now clean is
  // itself a failure, so the list cannot become a place to park a new defect.
  // Only the real checkout has those pairs: a `--root` fixture is a different
  // tree, and holding it to this repository's backlog would make every fixture
  // case fail for a reason it is not testing.
  const driftedPairs = new Set(knownDrift.map(pairOf));
  if (ARGS.root === undefined) {
    for (const rel of KNOWN_DRIFT) {
      if (!driftedPairs.has(rel)) {
        problems.push(
          `${rel}: listed in KNOWN_DRIFT but its two sides now agree - remove the entry`,
        );
      }
    }
    // The list may not grow. An entry that is not in the baseline is a new
    // suppression, which is the shape this list exists to prevent.
    if (ARGS.base !== undefined) {
      let baseline;
      try {
        baseline = readKnownDriftAt(ARGS.base);
      } catch (error) {
        // A caller who named a baseline and did not get one must not be told
        // the list was compared. This is an environment fault, not a verdict.
        console.error(`[check-bilingual] cannot read the KNOWN_DRIFT baseline: ${error.message}`);
        process.exit(2);
      }
      for (const rel of KNOWN_DRIFT) {
        if (!baseline.has(rel)) {
          problems.push(
            `${rel}: added to KNOWN_DRIFT since ${ARGS.base} - the list may only shrink; fix the pair instead`,
          );
        }
      }
    }
  }

  if (knownDrift.length) {
    console.warn(
      `[check-bilingual] ${knownDrift.length} known drift(s) in ${driftedPairs.size} pair(s) - reported, not failing. Clear them and remove the KNOWN_DRIFT entry:`,
    );
    for (const p of knownDrift) console.warn(`  ~ ${p}`);
  }

  if (problems.length) {
    console.error("Bilingual check failed:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `Bilingual check passed.${knownDrift.length ? ` (${knownDrift.length} known drift(s) reported)` : ""}`,
  );
}

/**
 * Negative cases for the rules above, each against a throwaway tree so the real
 * corpus is never read or rewritten. The fixture's file list arrives on stdin,
 * because a `--root` fixture is not a git checkout and `git ls-files` has
 * nothing to enumerate there. Forgetting that list is itself a case below:
 * with no enumeration and no piped list there is no corpus, which is an
 * environment fault rather than a clean run.
 *
 * Zero dependencies: `mkdtemp` plus child invocations of this same script.
 */
async function selfTest() {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-bilingual-selftest-"));
  const failures = [];

  // The fixture root is the mkdtemp directory itself. `--root` must exist when
  // the guard resolves it, so a subdirectory that the script has not created
  // yet would be refused as a missing path rather than scanned.
  const root = tmp;
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  const write = async (rel, text) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  };
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
  /** Invoke this script against the fixture, handing it the corpus on stdin. */
  const run = (files, args = []) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", root, ...args], {
      input: `${files.join("\n")}\n`,
      encoding: "utf8",
    });

  /**
   * Write a conforming pair and return its corpus entries. `zhBody` lands in
   * the Chinese side's body, the position the rules under test read.
   */
  const pair = async (stem, { enBody = "", zhBody = "", zhSwitcher, enSwitcher } = {}) => {
    const base = path.posix.basename(stem);
    const switcherZh = zhSwitcher ?? `[English](${base}.md) | 中文`;
    const switcherEn = enSwitcher ?? `English | [中文](${base}.zh.md)`;
    // Exactly one trailing newline, the shape rule 7 enforces, so the baseline
    // pair is clean and each case fails only for the rule under test. The body
    // is optional in these fixtures, so trailing blank lines are trimmed before
    // the single newline is added.
    await write(
      `${stem}.md`,
      `${[`# Title`, "", switcherEn, "", "## Problem", "", enBody].join("\n").trimEnd()}\n`,
    );
    await write(
      `${stem}.zh.md`,
      `${[`# Title`, "", switcherZh, "", "## Problem", "", zhBody].join("\n").trimEnd()}\n`,
    );
    return [`${stem}.md`, `${stem}.zh.md`];
  };
  /**
   * Write the consistency record for a fixture pair, the way a real
   * `bilingual:re-record` would. It is written here rather than by invoking
   * `--write` so that the baseline case exercises the same rules as every other
   * case instead of the recorder.
   */
  const writeRecordFile = async (stem) => {
    const { execFileSync } = await import("node:child_process");
    const hash = (rel) =>
      execFileSync("git", ["hash-object", path.join(root, rel)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const enBase = `${path.basename(stem)}.md`;
    const zhBase = `${path.basename(stem)}.zh.md`;
    await write(
      `${stem}.i18n.yaml`,
      `# record\n${enBase}: ${hash(`${stem}.md`)}\n${zhBase}: ${hash(`${stem}.zh.md`)}\n`,
    );
  };

  /** Invoke `--write` for one fixture pair. */
  const record = (stem, files) => run(files, ["--write", stem]);

  try {
    // 1. A conforming pair passes, so every case below fails for the rule under
    //    test rather than for the fixture.
    let files = await pair("docs/alpha");
    await writeRecordFile("docs/alpha");
    const alphaFiles = [...files, "docs/alpha.i18n.yaml"];
    expect("baseline pair", run(alphaFiles), 0, "passed");

    // 2. An English document with no counterpart is the defect the scope change
    //    exists for: before it, a new file outside docs/ carried no pair and no
    //    gate noticed.
    await write("src/widgets/beta.md", "# Title\n\n## Problem\n\nbody\n");
    expect("missing counterpart", run(["src/widgets/beta.md"]), 1, "missing Chinese counterpart");

    // 3. The switcher must link its sibling's actual file. `README.md` in the
    //    Chinese header shares a sibling's basename elsewhere in the tree and is
    //    not the sibling, so it fails the path comparison.
    files = await pair("docs/gamma", { zhSwitcher: "[English](README.md) | 中文" });
    await writeRecordFile("docs/gamma");
    // Kept for later cases: the link rules project a target through the corpus,
    // so a fixture that pipes only the pair under test cannot exercise them.
    const gammaFiles = [...files, "docs/gamma.i18n.yaml"];
    expect(
      "switcher points elsewhere",
      run([...files, "docs/gamma.i18n.yaml"]),
      1,
      "language-switcher line",
    );

    // 4. A section dropped from the translation fails, which is what the
    //    heading-sequence rule is for.
    await write("docs/delta.md", "# Title\n\nEnglish | [中文](delta.zh.md)\n\n## Problem\n\np\n");
    await write("docs/delta.zh.md", "# Title\n\n[English](delta.md) | 中文\n\n正文\n");
    await writeRecordFile("docs/delta");
    expect(
      "heading sequence differs",
      run(["docs/delta.md", "docs/delta.zh.md", "docs/delta.i18n.yaml"]),
      1,
      "heading levels differ",
    );

    // 5. Re-recording refuses a structurally broken pair instead of stamping it
    //    as confirmed-consistent. That refusal is the reason `--write` runs the
    //    checks at all, so it is pinned here.
    files = await pair("docs/epsilon", { zhSwitcher: "[English](missing.md) | 中文" });
    expect("write refuses a broken pair", record("docs/epsilon", files), 1, "refused");

    // 6. Re-recording a structurally sound pair is accepted, so case 5 rejects
    //    the structure and not the write.
    files = await pair("docs/zeta");
    expect("write records a sound pair", record("docs/zeta", files), 0, "re-recorded");

    // 7. An excluded document must not carry a pair: a `.zh.md` beside
    //    `AGENTS.md` would be a document nothing checks.
    await write("AGENTS.md", "# Instructions\n\n## Problem\n\np\n");
    await write("AGENTS.zh.md", "# 说明\n\n## Problem\n\np\n");
    expect(
      "excluded file with a pair",
      run(["AGENTS.md", "AGENTS.zh.md"]),
      1,
      "excluded from pairing but",
    );

    // 8. An orphan `.zh.md` with no English sibling is a half-created pair.
    await write("docs/eta.zh.md", "# 标题\n\n[English](eta.md) | 中文\n");
    expect(
      "orphan Chinese side",
      run(["docs/eta.zh.md"]),
      1,
      "Chinese counterpart without an English sibling",
    );

    // 9. Exactly one trailing newline, because that is what the sidecar hash and
    //    every other gate in this repository assume about a text file.
    files = await pair("docs/theta");
    await writeRecordFile("docs/theta");
    const theta = read("docs/theta.zh.md");
    await write("docs/theta.zh.md", `${theta}\n`);
    expect(
      "extra trailing newline",
      run(["docs/theta.md", "docs/theta.zh.md", "docs/theta.i18n.yaml"]),
      1,
      "more than one newline",
    );

    // 10. A corpus that cannot be enumerated is an environment fault, not a
    //     clean tree. A `--root` fixture is not a checkout, so this is the
    //     shape a run takes when it forgets to pipe the file list: the gate
    //     used to print `passed` for a tree it had never read. The spawn hands
    //     the child no stdin at all, which is stricter than piping an empty
    //     list, because an inherited empty pipe and an absent one must behave
    //     the same way here.
    expect(
      "fixture without a piped corpus",
      spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", root], {
        encoding: "utf8",
      }),
      2,
      "cannot enumerate the corpus",
    );

    // 11. A corpus entry that is not on disk is a list that lies about the
    //     tree. Dropping the entry silently hid the pair behind it.
    files = await pair("docs/ghost");
    await rm(path.join(root, "docs", "ghost.md"), { force: true });
    expect(
      "corpus entry missing on disk",
      run(files),
      1,
      "listed in the corpus but missing on disk",
    );
    // 11b. `CORPUS` is the whole git-known tree, not just the Markdown-ish
    //      subset this gate pairs: a `.ts` deleted from the working copy
    //      without staging the deletion is still corpus-listed and absent on
    //      disk, and is none of this gate's business. Reporting it here made
    //      an unrelated, unstaged deletion block the whole `bilingual:check`
    //      gate, which runs unscoped in the pre-commit hook.
    expect(
      "non-pair corpus entry missing on disk is not this gate's problem",
      run(["src/deleted-without-staging.ts"]),
      0,
      "passed",
    );
    // 12. A self-bilingual document needs no counterpart, which is the whole
    //     point of the exclusion: without it the two i18n tables would be
    //     reported as missing a `.zh.md` that would only duplicate them. The
    //     second half pins that the exclusion did not widen into "anything
    //     under docs/i18n is exempt" - a pair beside the table is still a
    //     document nothing checks.
    await write("docs/i18n/terminology.md", "# Terminology\n\n| English | 中文 |\n|---|---|\n");
    expect("self-bilingual document", run(["docs/i18n/terminology.md"]), 0, "passed");
    await write("docs/i18n/terminology.zh.md", "# 术语表\n");
    expect(
      "self-bilingual document with a pair",
      run(["docs/i18n/terminology.md", "docs/i18n/terminology.zh.md"]),
      1,
      "excluded from pairing but",
    );

    // 13. Fenced code is copied verbatim: a translated comment inside a block
    //     fails, because the block is what a reader copies. Every renderer and
    //     every reader sees the two blocks as different code.
    files = await pair("docs/iota", {
      enBody: "```bash\nnpm run verify   # the whole gate\n```",
      zhBody: "```bash\nnpm run verify   # 全量门禁\n```",
    });
    await writeRecordFile("docs/iota");
    expect(
      "translated fence body",
      run([...files, "docs/iota.i18n.yaml"]),
      1,
      "not byte-identical",
    );

    // 14. A four-backtick block may contain three-backtick fences, and it is one
    //     block. Reading the inner fence as the outer block's end made this
    //     module report differences that no reader would see, so the shape is
    //     pinned here.
    const nested = "````markdown\n```ts\nexport const x = 1;\n```\n````";
    files = await pair("docs/kappa", { enBody: nested, zhBody: nested });
    await writeRecordFile("docs/kappa");
    expect("nested fences are one block", run([...files, "docs/kappa.i18n.yaml"]), 0, "passed");
    //      The pair above cannot fail for the nesting rule on its own: a parser
    //      that splits the block in two splits it on both sides and still
    //      reports a match. The rule is therefore asserted directly.
    const nestedBlocks = indexFences(nested.split("\n")).fences;
    if (nestedBlocks.length !== 1 || !nestedBlocks[0].body.includes("```ts")) {
      failures.push(
        `nested fence parse: expected one block containing the inner fence, got ${nestedBlocks.length}`,
      );
    }

    // 15. A block dropped by the translation is reported as a count, not as a
    //     body mismatch, so the message names the defect.
    files = await pair("docs/mu", {
      enBody: "```sh\nnpm test\n```\n\n```sh\nnpm run lint\n```",
      zhBody: "```sh\nnpm test\n```",
    });
    await writeRecordFile("docs/mu");
    expect("fence dropped", run([...files, "docs/mu.i18n.yaml"]), 1, "fenced code block(s)");

    // 16. Table dimensions, independent of the cell text.
    files = await pair("docs/nu", {
      enBody: "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |",
      zhBody: "| 甲 | 乙 |\n|---|---|\n| 1 | 2 |",
    });
    await writeRecordFile("docs/nu");
    expect("table row dropped", run([...files, "docs/nu.i18n.yaml"]), 1, "table dimensions");

    // 17. A dropped list item, which is the defect a reader sees as a missing
    //     rule rather than as prose drift.
    files = await pair("docs/xi", {
      enBody: "- one\n- two\n- three",
      zhBody: "- 一\n- 二",
    });
    await writeRecordFile("docs/xi");
    expect("list item dropped", run([...files, "docs/xi.i18n.yaml"]), 1, "list 1 is");

    // 18. A dropped link: the projection makes `docs/alpha.md` on the English
    //     side and `docs/alpha.zh.md` on the Chinese side the same target, so
    //     only the missing link differs.
    files = await pair("docs/omicron", {
      enBody: "See [the gate](alpha.md) and [the guide](gamma.md).",
      zhBody: "见[门禁](alpha.zh.md)。",
    });
    await writeRecordFile("docs/omicron");
    expect(
      "link dropped",
      run([...alphaFiles, ...gammaFiles, ...files, "docs/omicron.i18n.yaml"]),
      1,
      "link targets differ",
    );

    // 19. A Chinese document that links the English file sends its reader to the
    //     wrong language; the counterpart exists, so the locale is the defect.
    files = await pair("docs/pi", {
      zhBody: "见[说明](alpha.md)。",
    });
    await writeRecordFile("docs/pi");
    expect(
      "Chinese side links the English file",
      run([...alphaFiles, ...files, "docs/pi.i18n.yaml"]),
      1,
      "links the Chinese counterpart",
    );

    // 20. The English side is hard-wrapped, so a wrapped line may begin with a
    //     list marker. Every renderer reads that as an item, so the gate reports
    //     the one-sided list instead of treating the line as prose.
    files = await pair("docs/rho", {
      enBody: "A triplet: one and two\n+ three, continuing the same sentence",
      zhBody: "三件套：一、二、三。",
    });
    await writeRecordFile("docs/rho");
    expect("wrapped marker line", run([...files, "docs/rho.i18n.yaml"]), 1, "list(s)");

    // 21. The mirror case: a link whose *text* wraps onto the next line is still
    //     one link. Reading line by line dropped it from the signature and
    //     reported two healthy notes as drifted, so it is pinned.
    files = await pair("docs/sigma", {
      enBody: "See the [onboarding\nguide](alpha.md).",
      zhBody: "见[上手指南](alpha.zh.md)。",
    });
    await writeRecordFile("docs/sigma");
    expect(
      "wrapped link text",
      run([...alphaFiles, ...files, "docs/sigma.i18n.yaml"]),
      0,
      "passed",
    );

    // 21b. A link written with a title (`[t](foo.md "title")`) is a link. The
    //      destination read `[^)\\s]+` before, so a titled link was invisible to
    //      the signature instead of being compared.
    files = await pair("docs/upsilon", {
      enBody: 'See [the gate](alpha.md "the gate").',
      zhBody: "见[门禁](alpha.zh.md)。",
    });
    await writeRecordFile("docs/upsilon");
    expect(
      "titled link target",
      run([...alphaFiles, ...files, "docs/upsilon.i18n.yaml"]),
      0,
      "passed",
    );

    // 21c. A query suffix belongs to the target, and the locale rule still
    //      applies to the path in front of it.
    files = await pair("docs/phi", {
      zhBody: "见[说明](alpha.md?plain=1)。",
    });
    await writeRecordFile("docs/phi");
    expect(
      "query suffix and locale",
      run([...alphaFiles, ...files, "docs/phi.i18n.yaml"]),
      1,
      "links the Chinese counterpart",
    );

    // 21d. A same-document anchor is counted even though its text is not
    //      compared: dropping a cross-reference is a defect a reader sees.
    files = await pair("docs/chi", {
      enBody: "See [one](#one) and [two](#two).\n\n## One\n\n## Two",
      zhBody: "见[一](#一)。\n\n## 一\n\n## 二",
    });
    await writeRecordFile("docs/chi");
    expect(
      "same-document anchor count",
      run([...files, "docs/chi.i18n.yaml"]),
      1,
      "same-document anchor link(s)",
    );

    // 21e. A quoted list is a list: the README quotes a callout, and its items
    //      are as droppable as any other.
    files = await pair("docs/psi", {
      enBody: "> - one\n> - two",
      zhBody: "> - 一",
    });
    await writeRecordFile("docs/psi");
    expect("quoted list item dropped", run([...files, "docs/psi.i18n.yaml"]), 1, "list 1 is");

    // 21f. A thematic break ends a list rather than continuing it: CommonMark
    //      reads `- one\n***\n- two` as two lists. Pinned with *no* blank line
    //      around the break, because a blank line closes the list anyway and the
    //      case would be green for a reason nobody chose.
    files = await pair("docs/omega", {
      enBody: "- one\n***\n- two",
      zhBody: "- 一\n- 二\n***",
    });
    await writeRecordFile("docs/omega");
    expect("thematic break splits lists", run([...files, "docs/omega.i18n.yaml"]), 1, "list(s)");

    // 21g. An image is not a link to the same target, so swapping one for the
    //      other is reported.
    files = await pair("docs/alpha2", {
      enBody: "![diagram](alpha.md)",
      zhBody: "[diagram](alpha.zh.md)",
    });
    await writeRecordFile("docs/alpha2");
    expect(
      "image versus link",
      run([...alphaFiles, ...files, "docs/alpha2.i18n.yaml"]),
      1,
      "link targets differ",
    );

    // 22. `--status` is the read-only census: it names an out-of-sync pair and
    //     still exits 0, because the corpus-wide run is what fails.
    files = await pair("docs/tau");
    await writeRecordFile("docs/tau");
    await write("docs/tau.zh.md", `${read("docs/tau.zh.md")}extra line\n`);
    expect(
      "status never fails",
      run([...files, "docs/tau.i18n.yaml"], ["--status"]),
      0,
      "out-of-sync",
    );

    // 23. `--pair` reports the named pair only, so an update loop is not red for
    //     a neighbour's drift. Both halves are asserted: the named pair's defect
    //     is present and the neighbour's is absent, because a filter that
    //     silenced everything would satisfy the first half alone.
    const scoped = run(
      [
        "docs/tau.md",
        "docs/tau.zh.md",
        "docs/tau.i18n.yaml",
        "docs/iota.md",
        "docs/iota.zh.md",
        "docs/iota.i18n.yaml",
      ],
      ["--pair", "docs/iota"],
    );
    expect("scoped pair reports its own defect", scoped, 1, "not byte-identical");
    if (`${scoped.stdout}${scoped.stderr}`.includes("docs/tau")) {
      failures.push("scoped pair reported a document it was not asked about (docs/tau)");
    }

    // 23b. `--write` with nothing named has no pair to confirm. Recording
    //      nothing and exiting 0 would read as "that pair is fine".
    expect(
      "write with no named pair",
      run(["docs/alpha.md", "docs/alpha.zh.md", "docs/alpha.i18n.yaml"], ["--write"]),
      2,
      "needs the pairs you confirmed",
    );

    // 24. A pair name outside the corpus is a usage fault, not a clean run.
    expect(
      "--pair outside the corpus",
      run(["docs/alpha.md"], ["--pair", "docs/nowhere"]),
      2,
      "outside the corpus",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // 25. `--write` pins each recorded blob against `git gc`: a blob
  //     `git hash-object -w` writes with nothing pointing to it is exactly
  //     what `git gc --prune=now` deletes (confirmed directly against this
  //     Git version). Every case above runs in a plain directory - not a
  //     checkout, so `git hash-object -w` itself fails there and this path
  //     never runs - so this one gets its own git-init'd fixture.
  {
    const gitTmp = await mkdtemp(path.join(os.tmpdir(), "check-bilingual-gcpin-"));
    try {
      const { execFileSync } = await import("node:child_process");
      const gitIn = (args) => execFileSync("git", args, { cwd: gitTmp, encoding: "utf8" });
      gitIn(["init", "-q"]);
      gitIn(["config", "user.email", "test@example.com"]);
      gitIn(["config", "user.name", "test"]);
      const writeIn = async (rel, text) => {
        await mkdir(path.dirname(path.join(gitTmp, rel)), { recursive: true });
        await writeFile(path.join(gitTmp, rel), text);
      };
      await writeIn(
        "docs/pinned.md",
        "# Title\n\nEnglish | [中文](pinned.zh.md)\n\n## Problem\n\nbody\n",
      );
      await writeIn(
        "docs/pinned.zh.md",
        "# Title\n\n[English](pinned.md) | 中文\n\n## Problem\n\n正文\n",
      );
      const writeResult = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--root", gitTmp, "--write", "docs/pinned"],
        { input: "docs/pinned.md\ndocs/pinned.zh.md\n", encoding: "utf8" },
      );
      if (writeResult.status !== 0) {
        failures.push(
          `gc-pin fixture: --write failed unexpectedly (exit ${writeResult.status}): ${writeResult.stdout}${writeResult.stderr}`,
        );
      } else {
        const enHash = gitIn(["hash-object", path.join(gitTmp, "docs/pinned.md")]).trim();
        const zhHash = gitIn(["hash-object", path.join(gitTmp, "docs/pinned.zh.md")]).trim();
        const refs = gitIn(["for-each-ref", "refs/bilingual-pairing/snapshots/"]);
        for (const [label, hash] of [
          ["English", enHash],
          ["Chinese", zhHash],
        ]) {
          if (!refs.includes(hash)) {
            failures.push(`gc-pin fixture: no snapshot ref for the ${label} blob (${hash})`);
          }
        }
        // The pin is what protects the blob from a real `git gc`; assert
        // that directly rather than trust the ref alone.
        gitIn(["gc", "--prune=now"]);
        for (const [label, hash] of [
          ["English", enHash],
          ["Chinese", zhHash],
        ]) {
          try {
            gitIn(["cat-file", "-p", hash]);
          } catch {
            failures.push(
              `gc-pin fixture: ${label} blob (${hash}) did not survive git gc --prune=now`,
            );
          }
        }
      }
    } finally {
      await rm(gitTmp, { recursive: true, force: true });
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
    for (const f of failures) console.error(`[check-bilingual] SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    "[check-bilingual] self-test passed (9 pair cases + enumeration-fault, missing-entry and non-pair-entry cases + self-bilingual exclusion cases + 19 structural-signature cases + scoped and status cases + a gc-pin case + shared --root guard cases).",
  );
}

if (process.argv.includes("--self-test")) {
  selfTest().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
