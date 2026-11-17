#!/usr/bin/env node
/**
 * Mirror `.agents/skills/` (single source of truth) to the Claude Code skills directory.
 *
 * Source:
 *   .agents/skills/                 (the only place humans edit)
 *
 * Targets (regenerated on every sync):
 *   .claude/skills/                 (Claude Code; gitignored, not committed)
 *
 * Each target gets a verbatim copy with an auto-generated banner prepended
 * to every `.md` file so a developer who opens the wrong copy is told to
 * edit `.agents/skills/` and re-sync.
 *
 * The target directory carries a `.gitignore` sentinel (`*` + `!.gitignore`)
 * so generated mirrors never enter git. The sentinel is part of the planned
 * output and is preserved across syncs.
 *
 * Usage:
 *   node scripts/sync-skills.mjs                       # sync all targets
 *   node scripts/sync-skills.mjs --check               # verify the mirror
 *                                                      # rebuilds from source
 *   node scripts/sync-skills.mjs --target claude
 *
 * `--check` does not diff the mirror against git, because the mirror is not in
 * git: an absent tree is a normal state on a clean clone, not drift. It checks
 * the invariant that does hold everywhere: the mirror on disk must be exactly
 * what a sync of the committed sources produces. A tree that is absent or
 * different is synchronised first, so the check is meaningful on a fresh
 * checkout, and the tree is then verified twice (a sync result must survive a
 * second application unchanged) so a non-idempotent generator fails rather
 * than reporting a verdict about bytes it produced non-deterministically.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * `--self-test` runs the negative cases against a throwaway tree instead of
 * this checkout. `--root <dir>` redirects the run; it is passed explicitly by
 * the self-test's child invocations, so no ambient environment variable can
 * divert an ordinary `skills:sync` at another tree - which would silently
 * prune that tree's `.claude/skills/`.
 */
/**
 * Parse this script's arguments. Every recognised argument is consumed and
 * anything left over is an error.
 *
 * Ignoring an unrecognised argument is what let a misspelled override scan the
 * default tree and report green: `-root <dir>` (a single-dash typo), `--Root`,
 * and `--rooot` were all dropped silently, and a caller who believes the run was
 * redirected cannot tell that verdict apart from a real one.
 */
function parseArgs(argv) {
  const fail = (message) => {
    console.error(`[sync-skills] ${message}`);
    process.exit(2);
  };
  const args = { selfTest: false, check: false, target: undefined, root: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--target" || arg.startsWith("--target=")) {
      if (args.target !== undefined) fail("--target given more than once");
      const value = arg === "--target" ? argv[i + 1] : arg.slice("--target=".length);
      if (!value || value.startsWith("--")) fail("--target requires a comma-separated list");
      args.target = value;
      if (arg === "--target") i += 1;
    } else if (arg === "--root" || arg.startsWith("--root=")) {
      // Two different roots is an ambiguous request, not a preference order.
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
  // at a real checkout cannot make the gate report green for the wrong tree.
  // The self-test passes a `mkdtemp` path.
  const resolved = path.resolve(ARGS.root);
  let tmp;
  try {
    tmp = realpathSync(os.tmpdir());
  } catch {
    // An unresolvable temp directory is an environment fault, not a lint
    // failure: exit 2, so it is never misread as "this tree has violations".
    console.error(`[sync-skills] cannot resolve the temp directory: ${os.tmpdir()}`);
    process.exit(2);
  }
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    console.error(`[sync-skills] --root does not exist: ${resolved}`);
    process.exit(2);
  }
  // Containment is decided with `path.relative`, not a string prefix. On
  // Windows two spellings differing only in case name the same directory, and
  // `path.win32.relative` compares case-insensitively where `startsWith` does
  // not. `..` is tested together with its separator so a legitimate child
  // directory whose name begins with dots is not mistaken for an escape, and an
  // absolute result catches a `--root` on another Windows drive.
  const rel = path.relative(tmp, real);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    console.error(
      `[sync-skills] refusing --root outside the temp directory: ${real}\n` +
        "             (this script prunes <root>/.claude/skills; only --self-test may redirect it)",
    );
    process.exit(2);
  }
  console.error(`[sync-skills] root override: ${real}`);
  return real;
})();
const SOURCE = path.join(ROOT, ".agents", "skills");

const TARGETS = {
  claude: path.join(ROOT, ".claude", "skills"),
};

const BANNER = [
  "<!--",
  "  AUTO-GENERATED by scripts/sync-skills.mjs.",
  "  Edit the source under .agents/skills/ and run `npm run skills:sync`.",
  "  Do not edit this file directly - changes will be overwritten.",
  "-->",
  "",
].join("\n");

const GITIGNORE_SENTINEL = "GITIGNORE_SENTINEL";
const SENTINEL_CONTENT = [
  "# Generated mirror of .agents/skills by scripts/sync-skills.mjs. Do not edit.",
  "*",
  "!.gitignore",
  "",
].join("\n");

const isCheck = ARGS.check;

function parseTargets() {
  if (ARGS.target === undefined) return Object.keys(TARGETS);
  const requested = ARGS.target
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const unknown = requested.filter((t) => !(t in TARGETS));
  if (unknown.length) {
    console.error(`[sync-skills] Unknown target(s): ${unknown.join(", ")}`);
    console.error(`              Known: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  return requested;
}

async function walk(dir, { tolerateRace = false } = {}) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (tolerateRace && ["ENOENT", "ENOTEMPTY", "EBUSY", "EPERM"].includes(error.code)) {
      return out;
    }
    // A source tree this gate cannot read is an environment fault, not a clean
    // mirror. It is the shape the copy in `check-note-links.mjs` had, and the
    // source-existence check upstream cannot see it, because a file is there.
    const relDir = path.relative(ROOT, dir).split(path.sep).join("/");
    console.error(`[sync-skills] cannot read ${relDir}: ${error.code}`);
    process.exit(2);
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(abs, { tolerateRace })));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function hash(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function decorate(relPath, content) {
  if (!relPath.toLowerCase().endsWith(".md")) return content;
  const text = content.toString("utf8");
  const frontmatterMatch = text.match(/^(---\r?\n[\s\S]*?\r?\n---)(\r?\n)?([\s\S]*)$/);
  if (frontmatterMatch) {
    const [, head, , body = ""] = frontmatterMatch;
    return `${head}\n${BANNER}${body.replace(/^(\r?\n)+/, "")}`;
  }
  return `${BANNER}${text}`;
}

async function readPlanned() {
  const sourceFiles = await walk(SOURCE);
  const planned = new Map();
  for (const abs of sourceFiles) {
    const rel = path.relative(SOURCE, abs);
    const raw = await readFile(abs);
    const out = Buffer.from(decorate(rel, raw));
    planned.set(rel.split(path.sep).join("/"), out);
  }
  // Every target carries a .gitignore sentinel so generated mirrors never
  // enter git. It is part of the planned output (checked, written, preserved).
  planned.set(GITIGNORE_SENTINEL, Buffer.from(SENTINEL_CONTENT, "utf8"));
  return planned;
}

async function readActual(targetDir) {
  const actual = new Map();
  if (!existsSync(targetDir)) return actual;
  const targetFiles = await walk(targetDir, { tolerateRace: true });
  for (const abs of targetFiles) {
    const rel = path.relative(targetDir, abs).split(path.sep).join("/");
    actual.set(rel, await readFile(abs));
  }
  return actual;
}

/**
 * Directories in the target that contain no files, relative to the target
 * root (the root itself is excluded). `walk` yields files only, so an empty
 * directory is invisible to both `readActual` and `diff`; without this list
 * `--check` would report a mirror as in sync while a stale skill shell sat
 * in it.
 *
 * A directory whose entire subtree is empty is reported at its topmost empty
 * ancestor: for `ghost/nested/` with nothing inside either level, the entry
 * is `ghost`, because a consumer enumerates skill directories and `ghost` is
 * the shell it would try to load. `--check` is non-destructive, so unlike
 * `pruneEmptyDirs` it cannot delete the inner level first to expose the
 * outer one; it reports the outermost instead.
 */
async function collectEmptyDirs(targetDir) {
  const empty = [];
  if (!existsSync(targetDir)) return empty;
  // Returns true when `dir` holds any non-directory entry anywhere beneath it.
  // Directories are the only thing searched through, so a symlink, a dotfile,
  // or any other special entry counts as content and keeps the directory out
  // of the drift report - matching `pruneEmptyDirs`, which also only removes a
  // directory when `readdir` reports it truly empty.
  const hasFile = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) return true;
      if (await hasFile(path.join(dir, entry.name))) return true;
    }
    return false;
  };
  const visit = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(dir, entry.name);
      if (await hasFile(abs)) {
        await visit(abs);
        continue;
      }
      // Topmost fileless ancestor: record it and do not descend, so a nested
      // empty shell is reported once, at the level a consumer enumerates.
      empty.push(path.relative(targetDir, abs).split(path.sep).join("/"));
    }
  };
  await visit(targetDir);
  return empty;
}

function diff(planned, actual) {
  const drift = [];
  for (const [rel, buf] of planned) {
    // The .gitignore sentinel lives at the target root (rel === ".gitignore").
    const relKey = rel === GITIGNORE_SENTINEL ? ".gitignore" : rel;
    const cur = actual.get(relKey);
    if (!cur) drift.push({ rel: relKey, kind: "missing" });
    else if (hash(cur) !== hash(buf)) drift.push({ rel: relKey, kind: "modified" });
  }
  for (const rel of actual.keys()) {
    // Map the real .gitignore back to its planned sentinel key before the
    // extra check; otherwise the sentinel always reports as an orphan.
    const plannedKey = rel === ".gitignore" ? GITIGNORE_SENTINEL : rel;
    if (!planned.has(plannedKey)) drift.push({ rel, kind: "extra" });
  }
  return drift.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function applyTarget(targetDir, planned) {
  // Idempotent: write all planned files first, then remove orphans.
  // This is safe when multiple processes run sync concurrently (e.g.
  // lint-staged chunks staged files into parallel command invocations
  // on Windows). The earlier "rm the whole dir then rewrite" approach
  // raced and produced ENOTEMPTY when two processes hit the same dir.
  await mkdir(targetDir, { recursive: true });

  for (const [rel, buf] of planned) {
    const abs =
      rel === GITIGNORE_SENTINEL ? path.join(targetDir, ".gitignore") : path.join(targetDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf);
  }

  if (!existsSync(targetDir)) return;
  const existing = await walk(targetDir, { tolerateRace: true });
  for (const abs of existing) {
    const rel = path.relative(targetDir, abs).split(path.sep).join("/");
    // Never delete the .gitignore sentinel - it keeps the whole tree out of git.
    if (rel === ".gitignore") continue;
    if (!planned.has(rel)) {
      try {
        await rm(abs, { recursive: true, force: true });
      } catch (err) {
        // Tolerate ENOENT/ENOTEMPTY from a sibling sync deleting the same
        // orphan first.
        if (err.code !== "ENOENT" && err.code !== "ENOTEMPTY") throw err;
      }
    }
  }
  await pruneEmptyDirs(targetDir);
}

/**
 * Remove directories left empty after orphan cleanup.
 *
 * `walk` only yields files, so a skill directory whose source was deleted
 * (or renamed) kept its shell behind: the files inside were pruned, the
 * directory itself was never visited, and it accumulated in the mirror.
 * An empty `<target>/<skill>/` is still a directory a consumer enumerates
 * when looking for skills, so it must not survive a sync. Depth-first, so a
 * parent that only contained pruned subtrees is removed in the same pass;
 * the target root and the `.gitignore` sentinel always survive.
 */
async function pruneEmptyDirs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(dir, entry.name);
    await pruneEmptyDirs(abs);
    const remaining = await readdir(abs);
    if (remaining.length === 0) {
      try {
        // `rm` needs recursive:true to remove a directory (even an empty
        // one - `recursive:false` reports ERR_FS_EISDIR); the deprecated
        // `fs.promises.rmdir` is avoided on Node 20+.
        await rm(abs, { recursive: true });
      } catch (err) {
        // Tolerate ENOENT/ENOTEMPTY from a concurrent sibling sync, and
        // EBUSY/EPERM where a scanner or antivirus holds the directory on
        // Windows - the next sync retries, and `--check` still reports it.
        if (!["ENOENT", "ENOTEMPTY", "EBUSY", "EPERM"].includes(err.code)) throw err;
      }
    }
  }
}

/**
 * Repeatable negative tests for the drift rules.
 *
 * The gate's value lives in the cases it rejects, and those were previously
 * only ever exercised by hand. This runs them against a throwaway tree so a
 * future edit that reopens the empty-directory hole fails here instead of in
 * review. Zero dependencies: `mkdtemp` plus child invocations of this same
 * script with an explicit `--root` pointed at the temporary tree.
 */
async function selfTest() {
  const { mkdtemp, mkdir: mk, writeFile: wf, symlink: sl } = await import("node:fs/promises");
  const os = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "sync-skills-selftest-"));
  const failures = [];

  const skillSource = path.join(tmp, ".agents", "skills", "demo");
  await mk(skillSource, { recursive: true });
  await wf(path.join(skillSource, "SKILL.md"), "---\nname: demo\n---\nbody\n");
  await wf(path.join(tmp, ".agents", "skills", ".gitkeep"), "");

  const target = path.join(tmp, ".claude", "skills");
  const run = (args) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", tmp, ...args], {
      encoding: "utf8",
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

  try {
    // 1. A fresh sync produces a mirror the check accepts.
    expect("sync fresh", run([]), 0, "Wrote");
    expect("check clean", run(["--check"]), 0, "matches its sources");

    // 2. The check is meaningful on a clean clone, where the mirror does not
    //    exist yet: absence is rebuilt, not reported as drift. Before this,
    //    the CI step ran `--check` on a fresh checkout and every file in the
    //    mirror was reported `missing`.
    await rm(target, { recursive: true, force: true });
    expect("check on absent mirror", run(["--check"]), 0, "matches its sources");
    if (!existsSync(target)) {
      failures.push("check on absent mirror: the mirror was not rebuilt");
    }

    // 3. Reconcile rather than report: a hand-edited file is put back, so the
    //    verdict describes the tree the check leaves behind. (The pre-commit
    //    hook deliberately does not rely on this: it exists to catch the edit,
    //    and this mode repairs it instead of failing.)
    await writeFile(path.join(target, "demo", "SKILL.md"), "hand edited\n");
    expect("check after hand edit", run(["--check"]), 0, "out of step");
    if ((await readFile(path.join(target, "demo", "SKILL.md"), "utf8")) === "hand edited\n") {
      failures.push("check after hand edit: the edit survived the reconciling sync");
    }

    // 4. A deleted mirror file is restored, which is the clean-clone case
    //    narrowed to one entry.
    await rm(path.join(target, "demo", "SKILL.md"), { force: true });
    expect("check after deletion", run(["--check"]), 0, "out of step");
    if (!existsSync(path.join(target, "demo", "SKILL.md"))) {
      failures.push("check after deletion: the file was not restored");
    }

    // 4b. An orphan file - one the sources do not produce - is pruned by the
    //     reconciling sync. A stale skill left behind by a rename is exactly
    //     this shape, and a consumer enumerates the mirror, so it would load a
    //     skill whose source no longer exists.
    await mk(path.join(target, "stale-skill"), { recursive: true });
    await wf(path.join(target, "stale-skill", "SKILL.md"), "---\nname: stale-skill\n---\nbody\n");
    expect("check prunes an orphan file", run(["--check"]), 0, "out of step");
    if (existsSync(path.join(target, "stale-skill"))) {
      failures.push("check prunes an orphan file: the orphan directory survived");
    }

    // 4c. The mirror is a byte copy, not a symlink: a symlinked tree breaks on
    //     Windows without Developer Mode and would make the mirror depend on
    //     the source's lifetime. Assert the entry is a regular file.
    const mirrored = path.join(target, "demo", "SKILL.md");
    if (existsSync(mirrored)) {
      const info = await stat(mirrored);
      if (!info.isFile()) {
        failures.push("mirror entry is not a regular file (a symlink or directory)");
      }
    }

    // 5. Empty directories are pruned by the reconciling sync, because a
    //    consumer enumerates skill directories and an empty shell reads as a
    //    stale skill. The nested shape is reported at its topmost ancestor.
    await mk(path.join(target, "ghost"), { recursive: true });
    await mk(path.join(target, "ghost2", "nested"), { recursive: true });
    expect("check reconciles empty dirs", run(["--check"]), 0, "matches its sources");
    for (const leftover of ["ghost", "ghost2"]) {
      if (existsSync(path.join(target, leftover))) {
        failures.push(`check reconciles empty dirs: ${leftover} survived`);
      }
    }

    // 5. A directory holding only a non-directory entry is content, not an
    //    empty shell - a symlink must keep it out of the drift report.
    await mk(path.join(target, "linked"), { recursive: true });
    let linkMade = false;
    try {
      await sl(path.join(tmp, "elsewhere"), path.join(target, "linked", "ref"));
      linkMade = true;
    } catch {
      // Symlink creation can fail without privilege (e.g. Windows without
      // Developer Mode). That must not read as a pass: say the case was
      // skipped so a green run is not mistaken for coverage.
      console.warn("[sync-skills] SKIP symlink-content case: no symlink privilege");
    }
    if (linkMade) {
      const withLink = run(["--check"]);
      if (withLink.status !== 0) {
        failures.push("check symlink dir: a directory containing a symlink reported as empty");
      }
    }

    // The source path replaced by a file: the existence check upstream passes
    // (something is there) and `readdir` fails ENOTDIR. Reporting "matches its
    // sources" for a tree that was never opened is the shape this gate shared
    // with the copy in `check-note-links.mjs`.
    await rm(path.join(tmp, ".agents", "skills"), { recursive: true, force: true });
    await wf(path.join(tmp, ".agents", "skills"), "not a directory\n");
    expect("source path is a file", run(["--check"]), 2, "cannot read .agents/skills");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // The `--root` guard cases are shared by every gate script, so every
  // copy of the guard answers to one list. The defect that motivated them was
  // several copies existing with only one carrying an assertion.
  const spawnRoot = (args, env) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  const { runGuardCases } = await import("./lib/guard-cases.mjs");
  await runGuardCases({ spawnRoot, failures, runArgs: ["--check"] });

  if (failures.length) {
    for (const f of failures) console.error(`[sync-skills] SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    "[sync-skills] self-test passed (reconcile cases for absence, hand edit, deletion and an orphan file, the byte-copy invariant, empty-dir prune, symlink content, unreadable-source fault, plus shared --root guard cases).",
  );
}

async function main() {
  if (SELF_TEST) {
    await selfTest();
    return;
  }
  if (!existsSync(SOURCE)) {
    console.error(`[sync-skills] Source not found: ${SOURCE}`);
    process.exit(2);
  }
  await stat(SOURCE);

  const requestedTargets = parseTargets();
  const planned = await readPlanned();

  if (isCheck) {
    let failures = 0;
    for (const name of requestedTargets) {
      const targetDir = TARGETS[name];
      // 1. Dry run, for the message only. A mirror that is absent (clean
      //    clone) or hand-edited is reconciled rather than failed on: absence
      //    is not drift, and the invariant worth failing on is the one
      //    asserted below.
      const before = diff(planned, await readActual(targetDir));
      if (before.length > 0) {
        console.log(
          `[sync-skills] ${name} mirror was absent or out of step (${before.length} entries); synchronising before verifying.`,
        );
      }
      await applyTarget(targetDir, planned);

      // 2. The written tree must equal the plan, including the empty-directory
      //    shape a consumer enumerates.
      const after = diff(planned, await readActual(targetDir));
      for (const rel of await collectEmptyDirs(targetDir)) {
        after.push({ rel, kind: "empty-dir" });
      }
      if (after.length > 0) {
        failures += after.length;
        console.error(
          `[sync-skills] FAIL ${name}: the mirror is not what a sync of the sources produces (${after.length} entries).`,
        );
        for (const { rel, kind } of after) console.error(`  ${kind.padEnd(9)} ${name}: ${rel}`);
        continue;
      }

      // 3. Applying the same plan a second time must be a no-op. A generator
      //    whose output depends on wall-clock time, a hash map's iteration
      //    order, or the previous contents would pass step 2 and fail here.
      const first = await readActual(targetDir);
      await applyTarget(targetDir, planned);
      const second = await readActual(targetDir);
      const changed = [];
      for (const [rel, buf] of first) {
        const next = second.get(rel);
        if (!next) changed.push({ rel, kind: "vanished" });
        else if (hash(next) !== hash(buf)) changed.push({ rel, kind: "changed" });
      }
      for (const rel of second.keys()) {
        if (!first.has(rel)) changed.push({ rel, kind: "appeared" });
      }
      if (changed.length > 0) {
        failures += changed.length;
        console.error(
          `[sync-skills] FAIL ${name}: a second sync of the same sources produced different bytes (${changed.length} entries).`,
        );
        for (const { rel, kind } of changed) console.error(`  ${kind.padEnd(9)} ${name}: ${rel}`);
        continue;
      }

      console.log(`[sync-skills] OK - ${name} mirror matches its sources (${planned.size} files).`);
    }
    if (failures > 0) process.exit(1);
    return;
  }

  for (const name of requestedTargets) {
    const targetDir = TARGETS[name];
    await applyTarget(targetDir, planned);
    console.log(`[sync-skills] Wrote ${planned.size} files → ${path.relative(ROOT, targetDir)}/`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
