#!/usr/bin/env node
/**
 * Docs hygiene gate.
 *
 * Six rules, each one a defect this repository has actually shipped:
 *
 *   1. Reachability. Every English doc under `docs/` (`foo.md`, not its
 *      `foo_zh.md` twin) must be reachable from one of the two entry points,
 *      `AGENTS.md` and `docs/README.md`, by following relative Markdown links.
 *      The link graph is the index: there is no `docs/INDEX.md`, so a doc that
 *      nothing links is a doc no reader and no agent will find. The root
 *      `README.md` is a 52 KB product landing page, not a navigation index,
 *      which is why it is not an entry point here.
 *   2. Frozen history. `docs/history/` is frozen: it is not required to be
 *      reachable from the entry points, but it has its own anchor,
 *      `docs/history/README.md`, which must reach every English doc under it.
 *      Without that second BFS the frozen area would be a hole where an
 *      unlinked doc is never reported.
 *   3. Links. Every relative link in a scanned doc resolves to an existing path
 *      inside the repository, and every `#fragment` names a heading or an
 *      explicit anchor of its target.
 *   4. Size. A doc under `docs/` over 50 KiB must be sliced (skeleton plus
 *      `references/`); three frozen specs are exempt by exact path.
 *   5. Landing page. `README.md` / `README.zh.md` are the published page (npm
 *      renders `README.md`), so slicing them is not the remedy: they warn at
 *      the 50 KiB doc red line and fail at their own 80 KiB ceiling. That keeps
 *      growth visible and bounded without breaking the landing page or the
 *      `readme:parity` contract that pins its structure.
 *   6. Line endings. No CRLF. Trailing whitespace is deliberately not checked:
 *      `.editorconfig` exempts `*.md` from trimming because two trailing spaces
 *      are a Markdown hard line break.
 *
 * Link extraction and repository-relative resolution live in
 * `lib/md-links.mjs`, shared with `check-note-links.mjs` and
 * `check-skill-links.mjs`.
 *
 * Usage:
 *   node scripts/check-docs.mjs              # exit 1 on violations
 *   node scripts/check-docs.mjs --self-test  # run the negative cases
 *   node scripts/check-docs.mjs --root <dir> # scan another tree (self-test only)
 *
 * Exit codes: 0 clean, 1 a violation, 2 an environment fault (the docs tree
 * cannot be read, a bad argument, an unusable `--root`).
 */
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { collectLinks, deadFragments, resolveInRepo } from "./lib/md-links.mjs";

const TAG = "[check-docs]";

/**
 * The two entry points that anchor the docs link graph. Both are roots: a doc
 * linked from either one is reachable. `AGENTS.md` is what an agent reads
 * first, `docs/README.md` is the human navigation page.
 */
const ENTRY_POINTS = ["AGENTS.md", "docs/README.md"];

/** The frozen history area and the README that must reach every doc in it. */
const HISTORY_PREFIX = "docs/history/";
const HISTORY_ANCHOR = "docs/history/README.md";

/**
 * Areas that are not navigable documentation. `docs/demo/` holds screenshots,
 * `docs/design/` holds design-tool exports; neither is authored Markdown, so
 * neither is required to be linked and neither is link-checked.
 */
const ASSET_PREFIXES = ["docs/demo/", "docs/design/"];

/**
 * Areas that are frozen and therefore off the entry-point link graph. A frozen
 * doc cannot be edited to add a link, so requiring reachability would demand an
 * edit the freeze forbids. `docs/history/` answers to its own anchor instead;
 * `docs/decisions/archived/` is superseded and reached through the ADR index.
 */
const FROZEN_PREFIXES = ["docs/history/", "docs/decisions/archived/"];

/** A doc under `docs/` over this size must be sliced. */
const DOC_FAIL_BYTES = 50 * 1024;
/** The published landing page: warn at the doc red line, fail at its ceiling. */
const README_WARN_BYTES = 50 * 1024;
const README_FAIL_BYTES = 80 * 1024;
const README_FILES = ["README.md", "README.zh.md"];

/**
 * Frozen specs that are over the red line and are exempt by exact path. They
 * are frozen: splitting one is a revision, not a cleanup, so the exemption
 * stays until that revision happens. Never add a live doc here.
 */
const SIZE_EXEMPT = new Set([
  "docs/history/specs/impl-m3.md",
  "docs/history/specs/impl-m3_zh.md",
  "docs/history/specs/totp-fix-plan.en.md",
]);

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
    console.error(`${TAG} ${message}`);
    process.exit(2);
  };
  const args = { selfTest: false, root: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      args.selfTest = true;
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
  // Containment is decided with `path.relative`, not a string prefix. On
  // Windows two spellings differing only in case name the same directory, and
  // `path.win32.relative` compares case-insensitively where `startsWith` does
  // not. `..` is tested together with its separator so a legitimate child
  // directory whose name begins with dots is not mistaken for an escape, and an
  // absolute result catches a `--root` on another Windows drive.
  const rel = path.relative(tmp, real);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    console.error(`${TAG} refusing --root outside the temp directory: ${real}`);
    process.exit(2);
  }
  console.error(`${TAG} root override: ${real}`);
  return real;
})();
const DOCS = path.join(ROOT, "docs");

/** Repository-relative, separator-normalised path of an absolute path. */
const repoRel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/**
 * Whether a path is the Chinese side of a bilingual pair.
 *
 * This repository uses two suffixes: `_zh.md` for docs and `.zh.md` for Agent
 * Notes. Only the English side has to be linked: the pairing gate
 * (`check-bilingual.mjs`) already guarantees the twin exists and the reader
 * reaches it through the language switcher, so requiring a second link per doc
 * would only add noise.
 */
const isChineseDoc = (rel) => rel.endsWith("_zh.md") || rel.endsWith(".zh.md");

/** Whether a path sits in a non-navigable asset area. */
const isAsset = (rel) => ASSET_PREFIXES.some((prefix) => rel.startsWith(prefix));

/** Whether a path sits in a frozen area that is off the entry-point graph. */
const isFrozen = (rel) => FROZEN_PREFIXES.some((prefix) => rel.startsWith(prefix));

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // A tree this gate cannot read is an environment fault, not a lint failure:
    // exit 2, so a directory that is missing or unreadable is never read as a
    // clean docs tree.
    console.error(`${TAG} cannot read ${repoRel(dir)}: ${error.code}`);
    process.exit(2);
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs)));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

/** Read a file, or `""` when it cannot be read. */
async function readIfExists(abs) {
  try {
    return await readFile(abs, "utf8");
  } catch {
    return "";
  }
}

/**
 * Follow relative Markdown links from `roots` and return every
 * repository-relative path reached, roots included.
 *
 * A link that leaves the repository is not followed: it cannot be validated
 * portably, and the per-file link rule reports it where it is written.
 */
async function reachableFrom(roots) {
  const reached = new Set();
  const queue = [...roots];
  const seen = new Set();
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    reached.add(rel);
    const text = await readIfExists(abs);
    for (const link of collectLinks(text)) {
      const target = resolveInRepo(ROOT, abs, link);
      if (target.kind === "escape") continue;
      if (target.rel.endsWith(".md")) queue.push(target.rel);
    }
  }
  return reached;
}

async function main() {
  if (SELF_TEST) {
    await selfTest();
    return;
  }
  const problems = [];
  const warnings = [];

  /**
   * Read a repository-relative Markdown target, or `undefined` when it is not a
   * readable file (a directory target, a missing file). Undefined means "this
   * gate cannot judge the fragment", not "the fragment is wrong".
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

  // An absent docs tree is an environment fault, not a clean tree. Without this
  // the walk below threw an uncaught ENOENT, which exits 1 and reads as "this
  // tree has violations" rather than "the gate could not open it".
  if (!existsSync(DOCS)) {
    console.error(`${TAG} ${repoRel(DOCS)} does not exist`);
    process.exit(2);
  }

  const files = await walk(DOCS);
  const relFiles = files.map((abs) => repoRel(abs)).sort();

  // 1. Reachability from the two entry points.
  const missingEntries = ENTRY_POINTS.filter((rel) => !existsSync(path.join(ROOT, rel)));
  for (const rel of missingEntries) {
    problems.push(`${rel} is missing - it anchors the docs link graph.`);
  }
  const candidates = relFiles.filter(
    (rel) => !isChineseDoc(rel) && !isAsset(rel) && !isFrozen(rel),
  );
  if (missingEntries.length === 0) {
    const reached = await reachableFrom(ENTRY_POINTS);
    for (const rel of candidates) {
      if (reached.has(rel)) continue;
      problems.push(
        `orphan doc: ${rel} is not reachable from ${ENTRY_POINTS.join(" or ")} by ` +
          "markdown links - link it from an entry point or from an already-reachable doc.",
      );
    }
  }

  // 2. The frozen history area answers to its own anchor instead.
  let historyCandidates = [];
  if (existsSync(path.join(ROOT, HISTORY_PREFIX))) {
    historyCandidates = relFiles.filter(
      (rel) => rel.startsWith(HISTORY_PREFIX) && !isChineseDoc(rel),
    );
    if (!existsSync(path.join(ROOT, HISTORY_ANCHOR))) {
      problems.push(`${HISTORY_ANCHOR} is missing - it anchors the frozen history area.`);
    } else {
      const reached = await reachableFrom([HISTORY_ANCHOR]);
      for (const rel of historyCandidates) {
        if (reached.has(rel)) continue;
        problems.push(
          `orphan history doc: ${rel} is not reachable from ${HISTORY_ANCHOR} by ` +
            "markdown links - link it from that README.",
        );
      }
    }
  }

  // 3 + 4 + 6. Per-file: link resolution, size, line endings, fragments.
  for (const abs of files) {
    const rel = repoRel(abs);
    const text = await readFile(abs, "utf8");
    const size = Buffer.byteLength(text, "utf8");

    if (!SIZE_EXEMPT.has(rel) && size > DOC_FAIL_BYTES) {
      problems.push(
        `${rel}: ${(size / 1024).toFixed(1)}KB exceeds ${DOC_FAIL_BYTES / 1024}KB hard limit - ` +
          "split it into a skeleton plus references/",
      );
    }

    if (text.includes("\r")) {
      problems.push(`${rel}: contains CRLF line endings - use LF`);
    }

    // A design-tool export is not authored Markdown: its links are the tool's,
    // not ours to keep resolving.
    if (isAsset(rel)) continue;

    // Relative link resolution, from the file's own directory.
    for (const filePart of collectLinks(text)) {
      const target = resolveInRepo(ROOT, abs, filePart);
      if (target.kind === "escape") {
        problems.push(
          `${rel}: link escapes the repository -> ${filePart} (resolves to ${target.rel})`,
        );
        continue;
      }
      if (!existsSync(target.abs)) {
        problems.push(`${rel}: broken link -> ${filePart} (resolves to ${target.rel})`);
      }
    }

    // A `#section` that no heading or explicit anchor in the target provides.
    // The link resolves, so nothing else reports it, and a renamed heading
    // otherwise breaks a reader's click silently.
    for (const dead of await deadFragments(text, loadTarget, (t) => resolveInRepo(ROOT, abs, t))) {
      problems.push(
        `${rel}: dead link fragment -> ${dead.ref} (no heading or anchor ` +
          `\`${dead.fragment}\` in ${dead.targetRel || rel})`,
      );
    }
  }

  // 3. Root-level files whose links the BFS follows but never validates.
  //    The BFS above silently skips missing targets, so a broken link in a
  //    root file used to go unreported. Resolve every relative link from the
  //    file's own directory instead.
  //
  //    Enumerated with readdir rather than a hardcoded list: a new root-level
  //    .md entry point (CONTRIBUTING.md, SECURITY.md) is then covered without
  //    editing this script, and the scan still stays one level deep, so it
  //    cannot wander into node_modules/ or the gated .agents/ trees.
  const rootFileNames = (await readdir(ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  for (const rf of rootFileNames) {
    const abs = path.join(ROOT, rf);
    const text = await readFile(abs, "utf8");
    for (const filePart of collectLinks(text)) {
      const target = resolveInRepo(ROOT, abs, filePart);
      // A link that escapes the repository cannot be validated (and would
      // resolve differently on another machine); report it rather than
      // letting existsSync answer for an unrelated file outside the tree.
      if (target.kind === "escape") {
        problems.push(
          `${rf}: link escapes the repository -> ${filePart} (resolves to ${target.rel})`,
        );
        continue;
      }
      // Assert the target exists. A directory is a legitimate target
      // (docs/README.md links `deployed/` on purpose), so a link to a
      // directory is accepted; only a path that resolves to nothing is broken.
      if (!existsSync(target.abs)) {
        problems.push(`${rf}: broken link -> ${filePart} (resolves to ${target.rel})`);
      }
    }
    for (const dead of await deadFragments(text, loadTarget, (t) => resolveInRepo(ROOT, abs, t))) {
      problems.push(
        `${rf}: dead link fragment -> ${dead.ref} (no heading or anchor ` +
          `\`${dead.fragment}\` in ${dead.targetRel || rf})`,
      );
    }
  }

  // 5. The published landing page: warn at the doc red line, fail at its own
  //    ceiling. It is not a reference doc, so slicing it is not the remedy;
  //    `readme:parity` keeps it structurally honest instead.
  for (const rf of README_FILES) {
    const abs = path.join(ROOT, rf);
    if (!existsSync(abs)) continue;
    const size = Buffer.byteLength(await readFile(abs, "utf8"), "utf8");
    if (size > README_FAIL_BYTES) {
      problems.push(
        `${rf}: ${(size / 1024).toFixed(1)}KB exceeds the ${README_FAIL_BYTES / 1024}KB ` +
          "landing-page ceiling - move reference material into docs/ and link it",
      );
    } else if (size > README_WARN_BYTES) {
      warnings.push(
        `${rf}: ${(size / 1024).toFixed(1)}KB is over the ${README_WARN_BYTES / 1024}KB doc ` +
          "red line - exempt as the published landing page, but move reference material " +
          "into docs/ rather than growing it",
      );
    }
  }

  for (const w of warnings) console.warn(`${TAG} WARN: ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`${TAG} FAIL: ${p}`);
    console.error(`${TAG} ${problems.length} problem(s). Fix and re-run.`);
    process.exit(1);
  }
  const historyNote =
    historyCandidates.length > 0
      ? `, ${historyCandidates.length} history docs reachable from ${HISTORY_ANCHOR}`
      : "";
  console.log(
    `${TAG} OK - ${candidates.length} docs reachable from ${ENTRY_POINTS.join(" and ")}` +
      `${historyNote}, no problems.`,
  );
}

/**
 * Repeatable negative tests for every rule above.
 *
 * Those rules exist to reject cases that were previously only exercised by
 * hand, so they are pinned here: an edit that stops reporting an orphan, a
 * broken or escaping link, a dead fragment, or an over-size doc fails this
 * instead of passing review. Zero dependencies - a temporary tree plus child
 * invocations of this script with `--root`.
 */
async function selfTest() {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-docs-selftest-"));
  const script = fileURLToPath(import.meta.url);
  const failures = [];

  const run = () =>
    spawnSync(process.execPath, [script, "--root", tmp], {
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
  /**
   * Rebuild the fixture tree from scratch. Every case starts from the same
   * baseline, so a file left behind by one case cannot make the next one pass
   * or fail for the wrong reason.
   */
  const build = async (files) => {
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(tmp, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, body);
    }
  };
  // Both entry points link the baseline doc, so `docs/target.md` is never an
  // orphan; only the rule under test decides the exit code.
  const BASE = {
    "AGENTS.md": "[target](docs/target.md)\n",
    "docs/README.md": "[target](target.md)\n",
    "docs/target.md": "# Target\n",
  };
  const big = (bytes) => `# Big\n\n${"x".repeat(bytes)}\n`;

  try {
    // 1. A resolvable link from both entry points passes.
    await build(BASE);
    expect("valid link", run(), 0, "OK");

    // 2. A doc nothing links is an orphan.
    await build({ ...BASE, "docs/orphan.md": "# Orphan\n" });
    expect("orphan doc", run(), 1, "orphan doc: docs/orphan.md");

    // 3. A relative link to a missing file is broken.
    await build({ ...BASE, "docs/target.md": "# Target\n\n[gone](./nope.md)\n" });
    expect("broken relative link", run(), 1, "broken link");

    // 4. A link that escapes the repository is reported separately rather than
    //    answered by existsSync for a file outside the tree.
    await build({ ...BASE, "docs/target.md": "# Target\n\n[out](../../outside.md)\n" });
    expect("repository escape", run(), 1, "escapes the repository");

    // 5. A fragment that names no heading is dead: the link resolves, so only
    //    this rule reports it, and the reader lands at the top of the page with
    //    no signal that the section is gone.
    await build({ ...BASE, "docs/target.md": "# Target\n\n[dead](target.md#missing)\n" });
    expect("dead fragment", run(), 1, "dead link fragment");

    // 6. A link *shown* in a fenced block or an inline span is an example of
    //    link syntax, not a link a reader can follow.
    await build({
      ...BASE,
      "docs/target.md":
        "# Target\n\n```md\n[fenced](./nope.md)\n```\n\nInline `[span](./nope2.md)`.\n",
    });
    expect("link inside code", run(), 0, "OK");

    // 7. A directory is a legitimate target (docs/README.md links one on
    //    purpose), so it must not be reported as broken.
    await build({
      ...BASE,
      "docs/adir/note.txt": "x\n",
      "AGENTS.md": "[target](docs/target.md)\n[dir](docs/adir)\n",
    });
    expect("directory link", run(), 0, "OK");

    // 8. A real in-repo name beginning with dots is not an escape. The target
    //    must sit at the root so `path.relative` yields exactly `..odd.md` -
    //    the shape a bare `startsWith("..")` test would misreport.
    await build({
      ...BASE,
      "..odd.md": "# Odd\n",
      "AGENTS.md": "[target](docs/target.md)\n[odd](..odd.md)\n",
    });
    expect("dot-prefixed name", run(), 0, "OK");

    // 9. A same-document fragment is checked against this file's own headings.
    await build({
      ...BASE,
      "AGENTS.md": "[target](docs/target.md)\n\n## Local section\n\n[t](#local-section)\n",
    });
    expect("same-document fragment", run(), 0, "OK");
    await build({
      ...BASE,
      "AGENTS.md": "[target](docs/target.md)\n\n## Local section\n\n[t](#gone)\n",
    });
    expect("dead same-document fragment", run(), 1, "dead link fragment");

    // 10. A heading slug comes from the rendered text: an inline code span keeps
    //     its contents and a link keeps its label. Deriving the slug from the
    //     raw source made real anchors look dead.
    await build({
      ...BASE,
      "docs/target.md": "# Target\n\n## Use `foo_bar` now\n\n## See [the guide](target.md)\n",
      "AGENTS.md": "[a](docs/target.md#use-foo_bar-now)\n[b](docs/target.md#see-the-guide)\n",
    });
    expect("rendered heading slugs", run(), 0, "OK");

    // 11. Repeated headings deduplicate on the slug GitHub emits, so a literal
    //     `foo-1` heading does not collide with a second `foo`.
    await build({
      ...BASE,
      "docs/target.md": "# Target\n\n## foo\n\n## foo-1\n\n## foo\n",
      "AGENTS.md":
        "[a](docs/target.md#foo)\n[b](docs/target.md#foo-1)\n[c](docs/target.md#foo-2)\n",
    });
    expect("repeated heading slugs", run(), 0, "OK");

    // 12. A heading whose punctuation is dropped keeps one dash per space, the
    //     way GitHub slugs it: `## Notes & limitations` is `notes--limitations`,
    //     not `notes-limitations`. Collapsing the run made the real anchor in
    //     README.md look dead.
    await build({
      ...BASE,
      "docs/target.md": "# Target\n\n## Notes & limitations\n",
      "AGENTS.md": "[a](docs/target.md#notes--limitations)\n",
    });
    expect("punctuation-dropped heading slug", run(), 0, "OK");

    // 13. A malformed percent escape names nothing: it is a dead fragment, not
    //     a crash the caller cannot read as a verdict.
    await build({ ...BASE, "AGENTS.md": "[t](docs/target.md)\n[x](docs/target.md#%)\n" });
    expect("malformed fragment escape", run(), 1, "dead link fragment");

    // 14. The frozen history area is not an orphan when its own anchor reaches
    //     it, and is one when nothing there links it.
    await build({
      ...BASE,
      "docs/history/README.md": "[old](specs/old.md)\n",
      "docs/history/specs/old.md": "# Old\n",
    });
    expect("history doc reachable from its anchor", run(), 0, "OK");
    await build({
      ...BASE,
      "docs/history/README.md": "# History\n",
      "docs/history/specs/old.md": "# Old\n",
    });
    expect("orphan history doc", run(), 1, "orphan history doc: docs/history/specs/old.md");

    // 15. A history area without its anchor is a violation, not a silent skip:
    //     otherwise deleting the README would make every frozen doc unreported.
    await build({ ...BASE, "docs/history/specs/old.md": "# Old\n" });
    expect("missing history anchor", run(), 1, "docs/history/README.md is missing");

    // 16. The asset and archived areas are not navigable docs, so an unlinked
    //     file there is not an orphan.
    await build({
      ...BASE,
      "docs/demo/shot.md": "# Shot\n",
      "docs/design/export.md": "# Export\n",
      "docs/decisions/archived/old.md": "# Old\n",
    });
    expect("asset and archived areas are not orphans", run(), 0, "OK");

    // 17. A doc over the 50 KiB red line must be sliced.
    await build({
      ...BASE,
      "docs/big.md": big(51 * 1024),
      "AGENTS.md": "[target](docs/target.md)\n[big](docs/big.md)\n",
    });
    expect("doc over the red line", run(), 1, "exceeds 50KB hard limit");

    // 18. The landing page warns at the doc red line and fails only at its own
    //     ceiling, so growth is visible without forcing a slice.
    await build({ ...BASE, "README.md": big(51 * 1024) });
    expect("README over the warn line", run(), 0, "WARN");
    await build({ ...BASE, "README.md": big(81 * 1024) });
    expect("README over the hard ceiling", run(), 1, "exceeds the 80KB landing-page ceiling");

    // 19. A missing entry point is a violation: the link graph has no anchor.
    await build({ "docs/README.md": "[target](target.md)\n", "docs/target.md": "# Target\n" });
    expect("missing entry point", run(), 1, "AGENTS.md is missing");

    // 20. A docs tree the gate cannot open is an environment fault, not a clean
    //     tree: `walk` fails closed instead of reporting zero orphans.
    await build({ "AGENTS.md": "# Agent\n" });
    expect("missing docs tree", run(), 2, "docs does not exist");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // The `--root` guard cases are shared by the gate scripts, so every copy of
  // the guard answers to one list. The defect that motivated them was several
  // copies existing with only one carrying an assertion.
  const spawnRoot = (args, env) =>
    spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  const { runGuardCases } = await import("./lib/guard-cases.mjs");
  await runGuardCases({ spawnRoot, failures });

  if (failures.length) {
    for (const f of failures) console.error(`${TAG} SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    `${TAG} self-test passed (orphan, broken link, repository escape, dead fragment, ` +
      "link inside code, directory link, dot-prefixed name, same-document and rendered " +
      "heading fragments, repeated slugs, punctuation-dropped slug, malformed escape, " +
      "history anchor and orphan, asset and archived areas, size red line, landing-page " +
      "warn and ceiling, missing entry point, missing docs tree, shared --root guard cases).",
  );
}

main().catch((err) => {
  // An unexpected throw is an environment fault, not a verdict on the tree:
  // exit 2, so it is never misread as "this tree has violations".
  console.error(err);
  process.exit(2);
});
