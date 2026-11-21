#!/usr/bin/env node
/**
 * Agent Note link gate (zero-dependency).
 *
 * Verifies every relative Markdown link inside `.agents/notes/`:
 *   1. It resolves to an existing path in this repository.
 *   2. It does not escape the repository (a target outside the tree resolves
 *      differently on another machine, so no verdict about it is portable).
 *   3. Locale consistency, in both directions: a link written in a `.zh.md`
 *      note points at the Chinese counterpart of a bilingual target, and a link
 *      written in an English note points at the English side. English-only
 *      instruction files (`AGENTS.md`) and external targets are exempt.
 *
 * Why this gate exists: `.agents/notes/README.md` states that cross-references
 * use relative links "so they are mechanically checkable", and nothing checked
 * them. `check-docs.mjs` walks `docs/` and the root files; the pairing gate
 * validates only the switcher link of each pair. A note tree that moves files
 * between lifecycles on every status change rots its links faster than any
 * other tree here, and the drift had already started when this gate was added.
 *
 * Notes under `archived/` are not scanned as sources: they are sealed and cannot
 * be repaired. Links into them from active notes are still checked.
 *
 * Link extraction and resolution come from `lib/md-links.mjs`, shared with
 * `check-docs.mjs` so the two gates cannot disagree about what a link is.
 *
 * Usage:
 *   node scripts/check-note-links.mjs             # exit 1 on violations
 *   node scripts/check-note-links.mjs --self-test # run the negative cases
 */

import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  chineseCounterpart,
  collectLinks,
  deadFragments,
  englishSource,
  resolveInRepo,
} from "./lib/md-links.mjs";

/**
 * `--self-test` runs the negative cases against a throwaway tree instead of
 * this checkout. `--root <dir>` redirects the scan; it is passed explicitly by
 * the self-test's child invocations, so no ambient environment variable can
 * divert an ordinary gate run at another tree. Unknown arguments are refused
 * rather than ignored: a misspelled override that silently scans the default
 * tree reports a green verdict about a tree the caller never named.
 */
function parseArgs(argv) {
  const fail = (message) => {
    console.error(`[check-note-links] ${message}`);
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
  const resolved = path.resolve(ARGS.root);
  let tmp;
  try {
    tmp = realpathSync(os.tmpdir());
  } catch {
    console.error(`[check-note-links] cannot resolve the temp directory: ${os.tmpdir()}`);
    process.exit(2);
  }
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    console.error(`[check-note-links] --root does not exist: ${resolved}`);
    process.exit(2);
  }
  // Containment is decided with `path.relative`, not a string prefix: on
  // Windows two spellings differing only in case name the same directory, and
  // `path.win32.relative` compares case-insensitively where `startsWith` does
  // not. `..` is tested together with its separator so a child directory whose
  // name begins with dots is not mistaken for an escape.
  const rel = path.relative(tmp, real);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    console.error(`[check-note-links] refusing --root outside the temp directory: ${real}`);
    process.exit(2);
  }
  console.error(`[check-note-links] root override: ${real}`);
  return real;
})();

const NOTES = path.join(ROOT, ".agents", "notes");

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // A tree this gate cannot read is an environment fault, not a clean tree:
    // swallowing the error reported `OK - 0 files` for a directory that was
    // never opened, and a notes path that is a file fails here with ENOTDIR.
    const relDir = path.relative(ROOT, dir).split(path.sep).join("/");
    console.error(`[check-note-links] cannot read ${relDir}: ${error.code}`);
    process.exit(2);
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs)));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

const ARCHIVED_PREFIX = ".agents/notes/archived/";
const relativeToRepo = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/**
 * Whether a repository-relative path has a Chinese counterpart on disk.
 *
 * The locale rule keys on the counterpart existing rather than on a prefix
 * allow-list, because the bilingual corpus is now the whole committed tree
 * (see `check-bilingual.mjs`). A path with no `.zh.md` beside it, such as the
 * English-only `AGENTS.md`, has no Chinese side to prefer.
 */
function hasChineseCounterpart(rel) {
  const counterpart = chineseCounterpart(rel);
  return counterpart !== undefined && existsSync(path.join(ROOT, counterpart));
}

/**
 * The locale verdict for one link, or `undefined` when the link is fine.
 *
 * Both directions are checked, because a bilingual tree has two ways to get the
 * locale wrong and only one of them was caught before:
 *   - a Chinese note linking the English side sends the reader the note exists
 *     for to the language they did not ask for;
 *   - an English note linking the Chinese side does the same in reverse, and it
 *     is the shape a copy-pasted switcher line produces.
 *
 * The switcher line is the one link whose target is the other language on
 * purpose, so it is exempt in both directions; the pairing gate owns it.
 *
 * @param {string} targetRel Repository-relative target of the link.
 * @param {boolean} isChinese Whether the linking file is a `.zh.md`.
 * @param {string | undefined} switcherTarget The other-language sibling the
 *   switcher of this file points at, if any.
 * @returns {string | undefined} A problem message, or `undefined`.
 */
function localeProblem(targetRel, isChinese, switcherTarget) {
  if (targetRel === switcherTarget) return undefined;
  if (isChinese) {
    if (!hasChineseCounterpart(targetRel)) return undefined;
    return `links to the English side -> ${targetRel}; link ${chineseCounterpart(targetRel)} instead`;
  }
  // English side: a `.zh.md` target is the Chinese side of a pair, so the
  // English note should have named the English source.
  const source = englishSource(targetRel);
  if (source === undefined || !existsSync(path.join(ROOT, source))) return undefined;
  return `links to the Chinese side -> ${targetRel}; link ${source} instead`;
}

async function main() {
  if (SELF_TEST) {
    await selfTest();
    return;
  }

  if (!existsSync(NOTES)) {
    console.error(`[check-note-links] ${path.relative(ROOT, NOTES)} does not exist`);
    process.exit(2);
  }

  const problems = [];
  // Links *out of* `archived/` are not checked. A sealed note cannot be repaired,
  // so a target that is later moved or deleted would leave a failure nobody is
  // allowed to fix (the seal in `check-archives.mjs` rejects the edit). Links
  // *into* it are still checked from the active notes that make them.
  const files = (await walk(NOTES))
    .filter((abs) => !relativeToRepo(abs).startsWith(ARCHIVED_PREFIX))
    .sort();

  /**
   * Read a repository-relative Markdown target, or `undefined` when it is not a
   * readable file. Undefined means "this gate cannot judge the fragment", not
   * "the fragment is wrong".
   */
  const loadTarget = async (rel) => {
    try {
      const info = await stat(path.join(ROOT, rel));
      if (!info.isFile()) return undefined;
      return await readFile(path.join(ROOT, rel), "utf8");
    } catch {
      return undefined;
    }
  };

  for (const abs of files) {
    const relToRepo = relativeToRepo(abs);
    const text = await readFile(abs, "utf8");
    const isChinese = relToRepo.endsWith(".zh.md");
    // The switcher line is the one link whose target is the other language on
    // purpose; it is the pairing gate's business, not this one's.
    const switcherTarget = isChinese ? englishSource(relToRepo) : chineseCounterpart(relToRepo);

    for (const link of collectLinks(text)) {
      const target = resolveInRepo(ROOT, abs, link);
      if (target.kind === "escape") {
        problems.push(
          `${relToRepo}: link escapes the repository -> ${link} (resolves to ${target.rel})`,
        );
        continue;
      }
      if (!existsSync(target.abs)) {
        problems.push(`${relToRepo}: broken link -> ${link} (resolves to ${target.rel})`);
        continue;
      }
      const locale = localeProblem(target.rel, isChinese, switcherTarget);
      if (locale !== undefined) problems.push(`${relToRepo}: ${locale}`);
    }

    // A `#section` that no heading or explicit anchor in the target provides.
    // The link resolves, so only this rule reports it: a renamed heading would
    // otherwise break a reader's click with no gate in the way.
    for (const dead of await deadFragments(text, loadTarget, (t) => resolveInRepo(ROOT, abs, t))) {
      problems.push(
        `${relToRepo}: dead link fragment -> ${dead.ref} (no heading or anchor \`${dead.fragment}\` in ${dead.targetRel || relToRepo})`,
      );
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`[check-note-links] FAIL: ${p}`);
    console.error(`[check-note-links] ${problems.length} problem(s). Fix and re-run.`);
    process.exit(1);
  }
  console.log(`[check-note-links] OK - ${files.length} files, links resolve and match locale.`);
}

/**
 * Negative cases for every rule above, each against a throwaway tree so the
 * real note tree is never read, plus the shared `--root` guard cases: this
 * script carries the same ~30-line guard as the other gate scripts, and the
 * defect that motivated `lib/guard-cases.mjs` was several copies existing with
 * only one of them asserted.
 */
async function selfTest() {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-note-links-selftest-"));
  const failures = [];

  const run = (args = ["--root", tmp]) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      env: { ...process.env },
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
  const notesDir = path.join(tmp, ".agents", "notes", "implemented", "process");
  const reset = () => rm(path.join(tmp, ".agents"), { recursive: true, force: true });

  /**
   * Write one note pair. `zhBody` lands in the body of the Chinese side, the
   * position the locale rule has to read; the English side always carries the
   * switcher the Chinese side points back at, and the Chinese side carries the
   * switcher the English side points at.
   */
  const writePair = async (stem, { enBody = "", zhBody = "" } = {}) => {
    await mkdir(notesDir, { recursive: true });
    const en = [
      `# Agent Note: ${stem}`,
      "",
      "Status: implemented",
      "",
      `English | [中文](${stem}.zh.md)`,
      "",
      "## Problem",
      "",
      enBody,
      "",
    ].join("\n");
    const zh = [
      `# Agent Note: ${stem}`,
      "",
      "Status: implemented",
      "",
      `[English](${stem}.md) | 中文`,
      "",
      "## Problem",
      "",
      zhBody,
      "",
    ].join("\n");
    await writeFile(path.join(notesDir, `${stem}.md`), en);
    await writeFile(path.join(notesDir, `${stem}.zh.md`), zh);
  };

  try {
    // 1. Baseline: a pair whose only links are the two switchers passes, so
    //    every case below fails for the rule under test rather than the fixture.
    await writePair("2026-01-01-baseline");
    expect("baseline pair", run(), 0, "OK");

    // 2. A link that resolves is accepted. The note tree crosses lifecycle
    //    folders on purpose (`../../rejected/...` moves a proposal out of the
    //    way), so this pins that the walk follows a link out of the file's own
    //    folder instead of only resolving what sits beside it.
    await reset();
    await writePair("2026-01-01-good", {
      enBody: "[other](../../rejected/process/2026-01-01-other.md)",
    });
    await mkdir(path.join(tmp, ".agents", "notes", "rejected", "process"), { recursive: true });
    await writeFile(
      path.join(tmp, ".agents", "notes", "rejected", "process", "2026-01-01-other.md"),
      [
        "# Agent Note: other",
        "",
        "Status: rejected - weighed and lost on cost",
        "",
        "## Problem",
        "",
        "p",
        "",
        "## Alternatives considered",
        "",
        "a",
        "",
      ].join("\n"),
    );
    expect("resolving link", run(), 0, "OK");

    // 3. A link to a name that matches no file is the defect the gate exists
    //    for: a bare filename reads as a cross-reference and resolves to
    //    nothing. `notes/README.md` names this shape as the thing relative
    //    links exist to prevent.
    await reset();
    await writePair("2026-01-01-broken", { enBody: "[other](2026-01-01-elsewhere.md)" });
    expect("broken link", run(), 1, "broken link");

    // 3b. A broken link inside a sealed note is not this gate's to report: the
    //     note cannot be edited, so the same link in an active note fails and
    //     in `archived/` is skipped. Both halves, or the skip could be a hole.
    await reset();
    const archivedDir = path.join(tmp, ".agents", "notes", "archived", "process");
    await mkdir(archivedDir, { recursive: true });
    await writeFile(
      path.join(archivedDir, "2026-01-01-sealed.md"),
      "# Agent Note: sealed\n\n[gone](2026-01-01-elsewhere.md)\n",
    );
    expect("broken link inside archived/", run(), 0, "OK");
    await writePair("2026-01-01-active-broken", { enBody: "[gone](2026-01-01-elsewhere.md)" });
    expect("same link in an active note", run(), 1, "broken link");

    // 3c. A locale mismatch inside a sealed note is skipped for the same reason,
    //     and the same link in an active note still fails. Without this half the
    //     archived skip could be a hole that hides a real locale error.
    await reset();
    await mkdir(archivedDir, { recursive: true });
    await writeFile(
      path.join(archivedDir, "2026-01-01-sealed-zh.zh.md"),
      "# Agent Note: sealed\n\n[English](2026-01-01-sealed-zh.md)\n",
    );
    await writeFile(
      path.join(archivedDir, "2026-01-01-sealed-zh.md"),
      "# Agent Note: sealed\n\n## Problem\n\np\n",
    );
    expect("locale mismatch inside archived/", run(), 0, "OK");

    // 4. A target outside the repository gets its own verdict rather than being
    //    answered by `existsSync` against an unrelated file on this machine.
    await reset();
    await writePair("2026-01-01-escape", { enBody: "[out](../../../../../etc/hosts)" });
    expect("escaping link", run(), 1, "escapes the repository");

    // 5. The rule this gate adds: a Chinese note linking the English side of a
    //    bilingual target. Both files exist, so only the locale rule can reject
    //    it, and the message has to name the counterpart to link.
    await reset();
    await writePair("2026-01-01-locale", {
      zhBody: "[其他](2026-01-01-baseline.md)",
    });
    await writePair("2026-01-01-baseline");
    expect("Chinese link to English side", run(), 1, "links to the English side");

    // 5b. The mirror image: an English note linking the Chinese side. This is
    //     the shape a copy-pasted switcher line produces, and it was unchecked
    //     while only the Chinese direction was enforced.
    await reset();
    await writePair("2026-01-01-locale-en", {
      enBody: "[other](2026-01-01-baseline.zh.md)",
    });
    await writePair("2026-01-01-baseline");
    expect("English link to Chinese side", run(), 1, "links to the Chinese side");

    // 6. The same link spelled with the Chinese counterpart passes, so case 5
    //    rejects the locale and not the link.
    await reset();
    await writePair("2026-01-01-locale-ok", {
      zhBody: "[其他](2026-01-01-baseline.zh.md)",
    });
    await writePair("2026-01-01-baseline");
    expect("Chinese link to Chinese side", run(), 0, "OK");

    // 6b. And the English side linking the English source passes, so case 5b
    //     rejects the locale and not the link.
    await reset();
    await writePair("2026-01-01-locale-en-ok", {
      enBody: "[other](2026-01-01-baseline.md)",
    });
    await writePair("2026-01-01-baseline");
    expect("English link to English side", run(), 0, "OK");

    // 7. The switcher itself points at the other language on purpose. Rejecting
    //    it would make every pair in the tree illegal, and it is the pairing
    //    gate that owns that line.
    await reset();
    await writePair("2026-01-01-switcher");
    expect("switcher exempt", run(), 0, "OK");

    // 8. An English-only target has no Chinese counterpart, so the locale rule
    //    cannot demand one. `AGENTS.md` placeholders are the real case.
    await reset();
    await writePair("2026-01-01-english-only", {
      zhBody: "[说明](../../AGENTS.md)",
    });
    await writeFile(path.join(tmp, ".agents", "notes", "AGENTS.md"), "# Agent Notes\n");
    expect("English-only target", run(), 0, "OK");

    // 9. A link to a directory is legitimate (the notes README links lifecycle
    //    folders on purpose), so only a target that resolves to nothing is
    //    broken.
    await reset();
    await writePair("2026-01-01-directory", { enBody: "[proposals](../../proposed)" });
    await mkdir(path.join(tmp, ".agents", "notes", "proposed"), { recursive: true });
    expect("directory target", run(), 0, "OK");

    // 10. A `.zh.md` whose counterpart exists but is not paired is still a
    //     bilingual target, so the rule keys on the path, not on the sidecar.
    await reset();
    await writePair("2026-01-01-no-sidecar", { zhBody: "[其他](../process/2026-01-01-base.md)" });
    await writePair("2026-01-01-base");
    expect("locale rule needs no sidecar", run(), 1, "links to the English side");

    // 11. A fragment that names no heading of the target is dead: the file
    //     resolves, so only this rule reports it.
    await reset();
    await writePair("2026-01-01-anchor", { enBody: "[t](2026-01-01-anchor.md#missing)" });
    expect("dead fragment", run(), 1, "dead link fragment");

    // 12. A heading slug and an explicit `<a id>` both resolve; the explicit
    //     anchor is how a translated heading keeps its source's anchor.
    await reset();
    await writePair("2026-01-01-anchor-live", {
      enBody:
        '## Live section\n\n<a id="kept"></a>\n\n[t](2026-01-01-anchor-live.md#live-section) [t](2026-01-01-anchor-live.md#kept)',
    });
    expect("live fragments", run(), 0, "OK");

    // 13. A same-document fragment is checked against this file's own headings.
    await reset();
    await writePair("2026-01-01-self", { enBody: "## Local section\n\n[t](#local-section)" });
    expect("live same-document fragment", run(), 0, "OK");
    await writePair("2026-01-01-self-dead", { enBody: "## Local section\n\n[t](#gone)" });
    expect("dead same-document fragment", run(), 1, "dead link fragment");

    // 14. A missing notes tree is an environment fault, not a clean tree: a
    //     wrong `--root` must not report success.
    await reset();
    expect("missing notes tree", run(), 2, "does not exist");

    // 15. A notes path that exists but is not a directory is the same class of
    //     fault. `readdir` fails with ENOTDIR there, and the walk used to
    //     swallow it and report `OK - 0 files` for a tree it never opened.
    await reset();
    await mkdir(path.join(tmp, ".agents"), { recursive: true });
    await writeFile(path.join(tmp, ".agents", "notes"), "# not a directory\n");
    expect("notes path is a file", run(), 2, "cannot read .agents/notes");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const spawnRoot = (args, env) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  const { runGuardCases } = await import("./lib/guard-cases.mjs");
  await runGuardCases({ spawnRoot, failures });

  if (failures.length) {
    for (const f of failures) console.error(`[check-note-links] SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    "[check-note-links] self-test passed (resolving link, broken link, archived outbound links skipped for both the dead-link and locale rules, escaping link, locale mismatch in both directions, switcher exempt, English-only target, directory target, dead fragments, unreadable-tree fault cases, shared --root guard cases).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
