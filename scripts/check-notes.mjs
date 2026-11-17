#!/usr/bin/env node
/**
 * Agent Note tree gate (zero-dependency).
 *
 * Verifies the `.agents/notes/` tree:
 *   1. Closed tree: only {lifecycle}/{class}/yyyy-mm-dd-kebab-title.md
 *      triplets are allowed; lifecycle is one of proposed/implemented/
 *      rejected/archived; class is one of the six closed classes; no
 *      INDEX.md anywhere inside the tree; AGENTS.md allowed only as
 *      lifecycle-directory placeholders (and `archived/manifest.json`, the
 *      byte seal owned by check-archives.mjs); the root carries only the
 *      README trio.
 *   2. Triplet completeness: every note has a .md + .zh.md + .i18n.yaml.
 *   3. Header/skeleton: Status agrees with the lifecycle dir; archived notes
 *      are Status: implemented + carry an Archived date that does not precede
 *      the filename date; implemented notes must not contain proposal-era
 *      headings; notes open with ## Problem and carry ## Alternatives
 *      considered; the .zh.md mirrors the English heading structure with the
 *      canonical section names kept in English.
 *   4. No orphan .zh.md / .i18n.yaml without its English note.
 *
 * Note: sidecar hash consistency is enforced by check-bilingual.mjs (the
 * pairing gate); this script owns tree shape + in-file format.
 *
 * Usage:
 *   node scripts/check-notes.mjs               # exit 1 on violations
 *   node scripts/check-notes.mjs --self-test   # run the negative cases
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * `--self-test` runs the negative cases against a throwaway tree instead of
 * this checkout. `--root <dir>` redirects the scan; it is passed explicitly by
 * the self-test's child invocations, so no ambient environment variable can
 * divert an ordinary gate run at another tree.
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
    console.error(`[check-notes] ${message}`);
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
    console.error(`[check-notes] cannot resolve the temp directory: ${os.tmpdir()}`);
    process.exit(2);
  }
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    console.error(`[check-notes] --root does not exist: ${resolved}`);
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
    console.error(`[check-notes] refusing --root outside the temp directory: ${real}`);
    process.exit(2);
  }
  console.error(`[check-notes] root override: ${real}`);
  return real;
})();
const NOTES = path.join(ROOT, ".agents", "notes");

const LIFECYCLES = ["proposed", "implemented", "rejected", "archived"];
const CLASSES = ["feature", "bug-fix", "simplification", "architecture", "process", "testing"];
const STEM_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
/**
 * The `rejected` reason is required, not optional: the contract lists
 * `rejected - <why, in one line>` as one of the three status forms and calls the
 * reason the one status with content, because a rejected note's verdict is the
 * fact readers come for. A bare `Status: rejected` is a verdict with no verdict,
 * so ` - .+` is mandatory rather than `(?: - .+)?`. The line is trimmed before
 * this runs, so a trailing separator with no text does not satisfy it.
 */
const STATUS_RE = /^Status: (proposed|implemented|rejected - .+)$/;
const ARCHIVED_RE = /^Archived: (\d{4}-\d{2}-\d{2})$/;

/**
 * The status word a lifecycle folder must declare.
 *
 * The rule is one sentence - the status word equals the folder name, and
 * `archived` is the single exception because it stays `implemented` (an
 * archived note *is* an implemented note whose rationale stopped guiding
 * future work, so archival moves the folder and adds an `Archived:` date; see
 * `.agents/notes/README.md` and `archived/AGENTS.md`).
 *
 * Comparing the status word to the folder name directly made the archived
 * lifecycle unreachable: every conforming note failed with "does not match
 * lifecycle dir", while the value that message implied (`Status: archived`) is
 * not in `STATUS_RE` at all and was rejected as malformed. Two contradictory
 * instructions and no third option.
 *
 * Written as the exception rather than a lookup table so the result is always
 * a string: a lifecycle added to `LIFECYCLES` without a rule here can never
 * silently skip the status check.
 */
const expectedStatus = (lifecycle) => (lifecycle === "archived" ? "implemented" : lifecycle);

const IMPLEMENTED_FORBIDDEN = [
  "## Proposal",
  "## Plan",
  "## Migration plan",
  "## Acceptance criteria",
];

/**
 * The recurring section names the note contract fixes, and the only headings
 * whose text is compared across languages.
 *
 * `.agents/notes/README.md` says recurring sections "use these canonical names
 * and nothing else, while genuinely bespoke technical sections remain free-form
 * between the required ones". A translation therefore keeps the canonical names
 * verbatim in English - they are machine tokens, like `# Agent Note: ` and the
 * `Status:` line - and translates only the bespoke headings. Comparing every
 * heading's text, as the reference implementation does, would reject a correct
 * translation of a bespoke section; comparing none of them would let a
 * translated `## 后果与取舍` stand in for `## Consequences`, which is the
 * canonical name the gate itself keys on.
 */
const CANONICAL_SECTIONS = new Set([
  "## Problem",
  "## Proposal",
  "## Decision",
  "## Alternatives considered",
  "## Acceptance criteria",
  "## Risks",
  "## Consequences",
  "## Plan",
  "## Migration plan",
  "## Testing",
  "## Verification",
  "## Deferred",
  "## Related",
]);

function walk(dir, relPrefix) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // A tree this gate cannot read is an environment fault, not a lint
    // failure: `check-note-links.mjs` already models exit 2 for the same
    // condition on this same tree, and an uncaught ENOTDIR here used to exit 1
    // with a stack trace, which reads as "this tree has violations" instead of
    // "the gate could not open it".
    const relDir = path.relative(ROOT, dir).split(path.sep).join("/");
    console.error(`[check-notes] cannot read ${relDir}: ${error.code}`);
    process.exit(2);
  }
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}

function headings(text) {
  return text
    .split("\n")
    .filter((l) => /^#{1,4} /.test(l))
    .map((l) => l.trim());
}

/** The `#` count of a heading line, so a demoted section is still a mismatch. */
const depthOf = (heading) => heading.match(/^#+/)[0].length;

function codeFenceCount(text) {
  let n = 0;
  for (const line of text.split("\n")) if (/^\s*```/.test(line)) n++;
  return n;
}

/**
 * Compare the Chinese side's heading structure against the English side's.
 *
 * Two rules, and they answer different questions:
 *   - the depth sequence must match exactly, so a section cannot be promoted,
 *     demoted, added or dropped in translation;
 *   - a heading that is a canonical section name in English must be the same
 *     canonical name in Chinese, because the gate and the contract key on those
 *     names. Bespoke headings are free to be translated.
 *
 * @param {string} enText
 * @param {string} zhText
 * @returns {string[]} problems, already phrased for the report
 */
function zhStructureProblems(enText, zhText) {
  const problems = [];
  // The H1 is the note title, which is translated on purpose; the machine token
  // that must stay English is checked separately.
  const enBody = headings(enText).filter((h) => !h.startsWith("# "));
  const zhBody = headings(zhText).filter((h) => !h.startsWith("# "));
  const enDepths = enBody.map(depthOf).join(",");
  const zhDepths = zhBody.map(depthOf).join(",");
  if (enDepths !== zhDepths) {
    problems.push(`heading structure does not mirror the English side (levels ${zhDepths})`);
    // The per-index comparison below would be meaningless once the sequences
    // differ in length, so the depth verdict is the whole answer here.
    return problems;
  }
  for (let i = 0; i < enBody.length; i += 1) {
    if (CANONICAL_SECTIONS.has(enBody[i]) && zhBody[i] !== enBody[i]) {
      problems.push(`canonical heading '${enBody[i]}' must stay English (found '${zhBody[i]}')`);
    }
  }
  return problems;
}

async function main() {
  if (SELF_TEST) {
    await selfTest();
    return;
  }
  const problems = [];
  if (!existsSync(NOTES)) {
    // An absent notes tree is an environment fault, not a lint failure: exit 2,
    // the posture `check-note-links` already takes, so a wrong `--root` is
    // never read as "this tree has violations".
    console.error("[check-notes] cannot read the notes tree: .agents/notes/ is missing");
    process.exit(2);
  }

  const files = walk(NOTES, "");
  // The tree root carries the note system's own documentation as a bilingual
  // triplet. It is not a note (it has no lifecycle, class or date), so it is
  // allowed here and skipped by every note rule below.
  const isRootReadme = (rel) =>
    ["README.md", "README.zh.md", "README.i18n.yaml"].includes(path.basename(rel)) &&
    !rel.includes("/");

  // 1. Tree shape: split each rel into [lifecycle, class, filename].
  const notes = []; // { rel, abs, lifecycle, cls, base, kind }
  for (const { rel, abs } of files) {
    const parts = rel.split("/");
    // The tree has no index: the filesystem tree plus the README link graph is
    // the index. Named explicitly and checked before any position rule, so the
    // message says what the file is instead of "unexpected file" or "bad
    // filename" - the two verdicts a reader would otherwise have to interpret.
    if (path.basename(rel) === "INDEX.md") {
      problems.push(`INDEX.md is not allowed in the notes tree: .agents/notes/${rel}`);
      continue;
    }
    if (parts.length === 1) {
      if (!isRootReadme(rel)) problems.push(`unexpected file at tree root: .agents/notes/${rel}`);
      continue;
    }
    const lifecycle = parts[0];
    if (!LIFECYCLES.includes(lifecycle)) {
      problems.push(`unknown lifecycle dir: .agents/notes/${lifecycle}`);
      continue;
    }
    if (parts.length === 2) {
      // [lifecycle, AGENTS.md] - placeholder, allowed
      if (parts[1] === "AGENTS.md") continue;
      // [archived, manifest.json] - the byte seal `check-archives.mjs` owns.
      // Allowed in `archived/` only: a manifest anywhere else seals nothing.
      if (lifecycle === "archived" && parts[1] === "manifest.json") continue;
      problems.push(`unexpected file in lifecycle dir: .agents/notes/${rel}`);
      continue;
    }
    const cls = parts[1];
    if (!CLASSES.includes(cls)) {
      problems.push(`unknown class dir: .agents/notes/${lifecycle}/${cls}`);
      continue;
    }
    if (parts.length > 3) {
      problems.push(`too deep: .agents/notes/${rel} (notes are flat in {class}/)`);
      continue;
    }
    const base = parts[2];
    const isSidecar = base.endsWith(".i18n.yaml");
    const isZh = base.endsWith(".zh.md");
    const stem = base.replace(/\.(md|zh\.md|i18n\.yaml)$/, "");
    if (!STEM_RE.test(stem)) {
      problems.push(
        `bad filename: .agents/notes/${rel} (want yyyy-mm-dd-kebab-title.md / .zh.md / .i18n.yaml)`,
      );
      continue;
    }
    if (isZh) {
      notes.push({ rel, abs, lifecycle, cls, base, kind: "zh" });
    } else if (isSidecar) {
      notes.push({ rel, abs, lifecycle, cls, base, kind: "sidecar" });
    } else {
      notes.push({ rel, abs, lifecycle, cls, base, kind: "en" });
    }
  }

  // 2. Triplet completeness + orphans.
  const enByKey = new Map();
  for (const n of notes.filter((n) => n.kind === "en")) {
    const key = `${n.lifecycle}/${n.cls}/${n.base.replace(/\.md$/, "")}`;
    enByKey.set(key, n);
  }
  for (const n of notes.filter((n) => n.kind !== "en")) {
    const key = `${n.lifecycle}/${n.cls}/${n.base.replace(/\.(zh\.md|i18n\.yaml)$/, "")}`;
    if (!enByKey.has(key)) {
      problems.push(`orphan: .agents/notes/${n.rel} has no English note ${key}.md`);
      continue;
    }
    const en = enByKey.get(key);
    if (n.kind === "zh" && !existsSync(en.abs.replace(/\.md$/, ".i18n.yaml"))) {
      problems.push(
        `${en.rel}: missing consistency record ${en.base.replace(/\.md$/, ".i18n.yaml")}`,
      );
    }
  }

  // 3. In-file format, per English note.
  for (const en of [...enByKey.values()]) {
    const parts = en.rel.split("/");
    const lifecycle = parts[0];
    const text = readFileSync(en.abs, "utf8");
    const lines = text.split("\n");
    const zhRel = `${en.lifecycle}/${en.cls}/${en.base.replace(/\.md$/, ".zh.md")}`;
    const zhExists = existsSync(path.join(ROOT, ".agents", "notes", zhRel));

    if (!/^# Agent Note: /.test(lines[0] ?? ""))
      problems.push(`${en.rel}: header must start with '# Agent Note: '`);
    // The Status line is the third line by contract, but it is located rather
    // than indexed so a missing header reports as a format problem instead of
    // an out-of-range crash.
    const statusIndex = lines.findIndex((l) => l.startsWith("Status:"));
    const statusLine = (lines[statusIndex] ?? "").trim();
    // For rejected notes the Status line carries a reason after " - "; the
    // lifecycle word is still just "rejected".
    const status = STATUS_RE.exec(statusLine)?.[1]?.split(" - ")[0];
    const expected = expectedStatus(lifecycle);
    if (!status) {
      // Name the required shape. A bare `Status: rejected` is the case this
      // message exists for: without the reason it reads as a format error with
      // no hint that the missing part is the verdict itself.
      const shape = lifecycle === "rejected" ? "rejected - <why, in one line>" : expected;
      problems.push(`${en.rel}: malformed Status line (expected 'Status: ${shape}')`);
    } else if (status !== expected) {
      problems.push(
        `${en.rel}: Status "${status}" does not match lifecycle dir "${lifecycle}" (expected "${expected}")`,
      );
    }

    // The `Archived:` line is a header field, not free text: the contract puts
    // it directly below `Status:` and only archived notes carry one. Reading it
    // with a whole-file `find` accepted a note whose header field was missing
    // whenever the body happened to contain a matching line, and left a date
    // line sitting in an active note as a half-archived state nothing reported.
    const archivedIndex = lines.findIndex((l) => l.startsWith("Archived:"));
    const archivedLine = (lines[archivedIndex] ?? "").trim();
    if (lifecycle === "archived") {
      // The status word is already covered by `expectedStatus` above; the date
      // line is the only archived-specific requirement.
      if (archivedIndex !== statusIndex + 1 || !ARCHIVED_RE.test(archivedLine)) {
        problems.push(
          `${en.rel}: archived note needs 'Archived: YYYY-MM-DD' on the line directly below Status`,
        );
      } else {
        // Snapshot invariant: the filename date (when the topic was first
        // proposed) and the `Archived:` date (when it was archived) both live
        // inside the file, so their order is checkable without git history -
        // unlike provenance, which a snapshot cannot see. A note cannot be
        // archived before it was proposed.
        //
        // ISO `yyyy-mm-dd` sorts lexicographically, so this compares strings
        // rather than `Date`s: no parsing, no timezone, no clock. Calendar
        // validity (`2026-13-45`) is out of scope here for the same reason it
        // is out of scope for the filename rule - the shape is what both
        // patterns enforce.
        const archivedDate = ARCHIVED_RE.exec(archivedLine)[1];
        const proposedDate = en.base.slice(0, 10);
        if (archivedDate < proposedDate) {
          problems.push(
            `${en.rel}: Archived date ${archivedDate} precedes the note's own date ${proposedDate}`,
          );
        }
      }
    } else if (archivedIndex !== -1) {
      problems.push(
        `${en.rel}: 'Archived:' line is only valid in archived/ (line ${archivedIndex + 1})`,
      );
    }
    if (lifecycle === "implemented" || lifecycle === "archived") {
      for (const h of IMPLEMENTED_FORBIDDEN) {
        if (lines.some((l) => l.trim() === h))
          problems.push(`${en.rel}: proposal-era heading '${h}' not allowed in ${lifecycle} note`);
      }
    }
    if (!lines.some((l) => l.trim() === "## Problem"))
      problems.push(`${en.rel}: must open body with '## Problem'`);
    if (!lines.some((l) => l.trim() === "## Alternatives considered"))
      problems.push(`${en.rel}: missing '## Alternatives considered' section`);

    // .zh.md mirror: same heading structure (levels, and the canonical names
    // kept in English) and the same code-fence count; machine tokens stay
    // English.
    if (zhExists) {
      const zhAbs = path.join(ROOT, ".agents", "notes", zhRel);
      const zh = readFileSync(zhAbs, "utf8");
      for (const problem of zhStructureProblems(text, zh)) {
        problems.push(`${zhRel}: ${problem}`);
      }
      if (codeFenceCount(text) !== codeFenceCount(zh))
        problems.push(`${zhRel}: code fence count differs from ${en.rel}`);
      if (!/^# Agent Note: /.test(zh.split("\n")[0] ?? ""))
        problems.push(`${zhRel}: machine token '# Agent Note: ' must stay English`);
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`[check-notes] FAIL: ${p}`);
    console.error(`[check-notes] ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(`[check-notes] OK - ${enByKey.size} notes, tree shape + format consistent.`);
}

/**
 * Repeatable negative tests for every rule above.
 *
 * The archived lifecycle is the case worth pinning hardest: its contract (keep
 * `Status: implemented`, add an `Archived:` date) is the one an obvious
 * implementation gets wrong, and when it was wrong the gate rejected every
 * conforming note while pointing at a status value that does not exist. The
 * tree-shape cases (illegal lifecycle, illegal class, INDEX.md, orphans) are
 * pinned because a closed tree is the whole point of the layout and each of
 * them is one line of code away from being silently accepted. Zero
 * dependencies: a temporary tree plus child invocations of this script with
 * `--root`.
 */
async function selfTest() {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-notes-selftest-"));
  const failures = [];

  const run = () =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", tmp], {
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
  const reset = () => rm(path.join(tmp, ".agents"), { recursive: true, force: true });

  /**
   * Write one note triplet. `bodyLine` lands inside `## Problem`, i.e. in free
   * text rather than the header block - the position the `Archived:` rule has
   * to distinguish from. `zhHeadings` replaces the Chinese side's body headings
   * so the structure rule can be exercised without touching the English side.
   */
  const writeNote = async (
    lifecycle,
    stem,
    statusLines,
    decisionHeading = "## Decision",
    bodyLine,
    zhHeadings,
  ) => {
    const dir = path.join(tmp, ".agents", "notes", lifecycle, "process");
    await mkdir(dir, { recursive: true });
    const body = (title, heading = decisionHeading) =>
      [
        `# Agent Note: ${title}`,
        "",
        ...statusLines,
        "",
        "## Problem",
        "",
        "p",
        ...(bodyLine ? ["", bodyLine] : []),
        "",
        heading,
        "",
        "d",
        "",
        "## Alternatives considered",
        "",
        "a",
        "",
        "## Consequences",
        "",
        "c",
        "",
      ].join("\n");
    await writeFile(path.join(dir, `${stem}.md`), body("Self-test note"));
    const zhBody = zhHeadings
      ? [
          "# Agent Note: 自检笔记",
          "",
          ...statusLines,
          "",
          "## Problem",
          "",
          "p",
          "",
          ...zhHeadings.flatMap((h) => [h, "", "x", ""]),
        ].join("\n")
      : body("自检笔记");
    await writeFile(path.join(dir, `${stem}.zh.md`), zhBody);
    await writeFile(path.join(dir, `${stem}.i18n.yaml`), "# sidecar\n");
  };

  try {
    // 1. A conforming implemented note passes - the baseline. It carries no
    //    `Archived:` line, which pins that the date requirement is not global.
    await writeNote("implemented", "2026-01-01-baseline", ["Status: implemented"]);
    expect("implemented note", run(), 0, "OK");

    // 2. A conforming archived note passes. Regression: the status word stays
    //    `implemented` because only the folder changes.
    await reset();
    await writeNote("archived", "2026-01-01-archived", [
      "Status: implemented",
      "Archived: 2026-01-02",
    ]);
    expect("archived note", run(), 0, "OK");

    // 3. `Status: archived` is not a status word. This is the value the old
    //    contradictory error message pointed at, so it is the attractor the
    //    fix has to keep rejecting rather than accepting both spellings.
    await reset();
    await writeNote("archived", "2026-01-01-archived-status-word", [
      "Status: archived",
      "Archived: 2026-01-02",
    ]);
    expect("archived with Status: archived", run(), 1, "malformed Status line");

    // 4. An archived note must carry the date line directly below Status.
    await reset();
    await writeNote("archived", "2026-01-01-archived-no-date", ["Status: implemented"]);
    expect("archived without date", run(), 1, "directly below Status");

    // 5. The other lifecycles still require their own status word.
    await reset();
    await writeNote("proposed", "2026-01-01-mismatch", ["Status: implemented"]);
    expect("status/dir mismatch", run(), 1, 'does not match lifecycle dir "proposed"');

    // 6. Proposal-era headings stay rejected in an archived note.
    await reset();
    await writeNote(
      "archived",
      "2026-01-01-archived-proposal-heading",
      ["Status: implemented", "Archived: 2026-01-02"],
      "## Proposal",
    );
    expect("archived proposal-era heading", run(), 1, "proposal-era heading");

    // 6b. The same heading is legal in `proposed/`, so case 6 rejects the
    //     lifecycle and not the heading itself.
    await reset();
    await writeNote("proposed", "2026-01-01-proposal-ok", ["Status: proposed"], "## Proposal");
    expect("proposal-era heading in proposed/", run(), 0, "OK");

    // 7. A matching line in the body does not stand in for the header field.
    //    A whole-file search accepted this; the date has to sit where the
    //    contract puts it.
    await reset();
    await writeNote(
      "archived",
      "2026-01-01-archived-date-in-body",
      ["Status: implemented"],
      "## Decision",
      "Archived: 2020-01-01",
    );
    expect("archived date only in body", run(), 1, "directly below Status");

    // 8. A date line in an active note is a half-archived state, not a no-op.
    await reset();
    await writeNote("implemented", "2026-01-01-half-archived", [
      "Status: implemented",
      "Archived: 2026-01-02",
    ]);
    expect("archived line outside archived/", run(), 1, "only valid in archived/");

    // 9. A rejected note carries its verdict on the Status line, so the reason
    //    is required. A bare `Status: rejected` used to pass, which accepted a
    //    verdict with no verdict.
    await reset();
    await writeNote("rejected", "2026-01-01-rejected-no-reason", ["Status: rejected"]);
    expect("rejected without reason", run(), 1, "malformed Status line");

    // 10. A separator with no text after it is not a reason either. The
    //     `Status:` line is trimmed before matching, so trailing whitespace
    //     falls into this same case rather than slipping past `.+`.
    await reset();
    await writeNote("rejected", "2026-01-01-rejected-empty-reason", ["Status: rejected - "]);
    expect("rejected with empty reason", run(), 1, "malformed Status line");

    // 11. The conforming form still passes, so the rule rejects the missing
    //     reason and not the lifecycle itself.
    await reset();
    await writeNote("rejected", "2026-01-01-rejected-with-reason", [
      "Status: rejected - the alternative was weighed and lost on cost",
    ]);
    expect("rejected with reason", run(), 0, "OK");

    // 12. An `AGENTS.md` placeholder in a lifecycle directory is allowed: it is
    //     the one non-triplet the tree accepts.
    await reset();
    await writeNote("implemented", "2026-01-01-with-placeholder", ["Status: implemented"]);
    await writeFile(
      path.join(tmp, ".agents", "notes", "implemented", "AGENTS.md"),
      "# Placeholder\n",
    );
    expect("lifecycle AGENTS.md placeholder", run(), 0, "OK");

    // 13. The same filename one level deeper is not a placeholder, so the rule
    //     is shown to permit exactly that one path rather than any `AGENTS.md`.
    await reset();
    await writeNote("implemented", "2026-01-01-nested-agents", ["Status: implemented"]);
    await writeFile(
      path.join(tmp, ".agents", "notes", "implemented", "process", "AGENTS.md"),
      "# Not a placeholder\n",
    );
    expect("nested AGENTS.md rejected", run(), 1, "bad filename");

    // 14. `archived/manifest.json` is the byte seal, so the archive root accepts
    //     it. Only there: the same file in another lifecycle seals nothing and
    //     would let a stray JSON ride in the tree.
    await reset();
    await writeNote("archived", "2026-01-01-sealed", [
      "Status: implemented",
      "Archived: 2026-01-02",
    ]);
    await writeFile(path.join(tmp, ".agents", "notes", "archived", "manifest.json"), "{}\n");
    expect("archived manifest.json allowed", run(), 0, "OK");
    await reset();
    await writeNote("implemented", "2026-01-01-stray-manifest", ["Status: implemented"]);
    await writeFile(path.join(tmp, ".agents", "notes", "implemented", "manifest.json"), "{}\n");
    expect("manifest.json outside archived/", run(), 1, "unexpected file in lifecycle dir");

    // 15. A note cannot be archived before it was proposed. Both dates live in
    //     the file, so this needs no history - but nothing compared them, and
    //     an archive dated months before its own filename passed.
    await reset();
    await writeNote("archived", "2026-06-01-late-topic", [
      "Status: implemented",
      "Archived: 2026-01-01",
    ]);
    expect("archive date precedes note date", run(), 1, "precedes the note's own date");

    // 16. Same day is legal: a note proposed and archived on one day is a real
    //     case, so the rule is `<`, not `<=`.
    await reset();
    await writeNote("archived", "2026-06-01-same-day", [
      "Status: implemented",
      "Archived: 2026-06-01",
    ]);
    expect("archive date equals note date", run(), 0, "OK");

    // 17. A later date is the ordinary case and must stay green.
    await reset();
    await writeNote("archived", "2026-06-01-later", [
      "Status: implemented",
      "Archived: 2026-06-02",
    ]);
    expect("archive date after note date", run(), 0, "OK");

    // 18. A missing notes tree is an environment fault, not a lint failure: a
    //     wrong `--root` must not be read as "this tree has violations".
    await reset();
    expect("missing notes tree", run(), 2, "cannot read the notes tree");

    // 19. `existsSync` is true for a file as well as a directory, so a notes
    //     path that exists but is not a directory reaches `walk` itself, which
    //     is the case that exercises `walk`'s own fail-closed catch, which
    //     case 18 cannot reach.
    await reset();
    await mkdir(path.join(tmp, ".agents"), { recursive: true });
    await writeFile(path.join(tmp, ".agents", "notes"), "# not a directory\n");
    expect("notes path is a file", run(), 2, "cannot read .agents/notes");

    // 20. The tree is closed: a lifecycle folder outside the four is refused
    //     rather than walked as if it were a class directory.
    await reset();
    await writeNote("implemented", "2026-01-01-legal-lifecycle", ["Status: implemented"]);
    await mkdir(path.join(tmp, ".agents", "notes", "draft", "process"), { recursive: true });
    await writeFile(
      path.join(tmp, ".agents", "notes", "draft", "process", "2026-01-01-x.md"),
      "# Agent Note: x\n\nStatus: proposed\n\n## Problem\n\np\n",
    );
    expect("illegal lifecycle dir", run(), 1, "unknown lifecycle dir: .agents/notes/draft");

    // 21. The class set is closed too: a plausible new class is refused until
    //     the canonical set and the README are updated together.
    await reset();
    await writeNote("implemented", "2026-01-01-legal-class", ["Status: implemented"]);
    await mkdir(path.join(tmp, ".agents", "notes", "implemented", "refactor"), { recursive: true });
    await writeFile(
      path.join(tmp, ".agents", "notes", "implemented", "refactor", "2026-01-01-y.md"),
      "# Agent Note: y\n\nStatus: implemented\n\n## Problem\n\np\n",
    );
    expect("illegal class dir", run(), 1, "unknown class dir: .agents/notes/implemented/refactor");

    // 22. `INDEX.md` is banned anywhere in the tree: the tree plus the README
    //     link graph is the index, and a hand-maintained list rots. Both
    //     positions are pinned, because the root and a class directory reach
    //     different branches of the shape check.
    await reset();
    await writeNote("implemented", "2026-01-01-index-root", ["Status: implemented"]);
    await writeFile(path.join(tmp, ".agents", "notes", "INDEX.md"), "# Index\n");
    expect("INDEX.md at the tree root", run(), 1, "INDEX.md is not allowed");
    await reset();
    await writeNote("implemented", "2026-01-01-index-class", ["Status: implemented"]);
    await writeFile(
      path.join(tmp, ".agents", "notes", "implemented", "process", "INDEX.md"),
      "# Index\n",
    );
    expect("INDEX.md in a class dir", run(), 1, "INDEX.md is not allowed");

    // 23. An orphan `.zh.md` is a half-created pair: the Chinese side exists and
    //     the English side it mirrors does not.
    await reset();
    await mkdir(path.join(tmp, ".agents", "notes", "implemented", "process"), { recursive: true });
    await writeFile(
      path.join(tmp, ".agents", "notes", "implemented", "process", "2026-01-01-orphan.zh.md"),
      "# Agent Note: 孤儿\n\nStatus: implemented\n\n## Problem\n\np\n",
    );
    expect(
      "orphan .zh.md",
      run(),
      1,
      "orphan: .agents/notes/implemented/process/2026-01-01-orphan.zh.md",
    );

    // 24. An orphan `.i18n.yaml` is the same half-created state on the sidecar
    //     axis, and it is a separate branch of the orphan rule.
    await reset();
    await mkdir(path.join(tmp, ".agents", "notes", "implemented", "process"), { recursive: true });
    await writeFile(
      path.join(tmp, ".agents", "notes", "implemented", "process", "2026-01-01-orphan.i18n.yaml"),
      "# sidecar\n",
    );
    expect(
      "orphan .i18n.yaml",
      run(),
      1,
      "orphan: .agents/notes/implemented/process/2026-01-01-orphan.i18n.yaml",
    );

    // 25. A note without `## Problem` has no motivation, which is the one
    //     section every lifecycle requires.
    await reset();
    await writeNote("implemented", "2026-01-01-no-problem", ["Status: implemented"]);
    const noProblem = path.join(tmp, ".agents", "notes", "implemented", "process");
    for (const name of ["2026-01-01-no-problem.md", "2026-01-01-no-problem.zh.md"]) {
      await writeFile(
        path.join(noProblem, name),
        "# Agent Note: t\n\nStatus: implemented\n\n## Decision\n\nd\n\n## Alternatives considered\n\na\n",
      );
    }
    expect("missing ## Problem", run(), 1, "must open body with '## Problem'");

    // 26. A note without `## Alternatives considered` records a decision with
    //     nothing it beat, which invites re-litigation.
    await reset();
    await writeNote("implemented", "2026-01-01-no-alternatives", ["Status: implemented"]);
    for (const name of ["2026-01-01-no-alternatives.md", "2026-01-01-no-alternatives.zh.md"]) {
      await writeFile(
        path.join(noProblem, name),
        "# Agent Note: t\n\nStatus: implemented\n\n## Problem\n\np\n\n## Decision\n\nd\n",
      );
    }
    expect("missing ## Alternatives considered", run(), 1, "missing '## Alternatives considered'");

    // 27. The Chinese side must keep the English heading levels. A section
    //     dropped in translation is the drift this rule exists for.
    await reset();
    await writeNote(
      "implemented",
      "2026-01-01-zh-structure",
      ["Status: implemented"],
      "## Decision",
      undefined,
      ["## Decision", "## Alternatives considered"],
    );
    expect("zh heading structure mismatch", run(), 1, "heading structure does not mirror");

    // 28. A canonical section name translated on the Chinese side is a machine
    //     token drifting, not a translation choice: the gate and the contract
    //     key on `## Consequences`. Bespoke headings stay free to translate,
    //     which case 29 pins.
    await reset();
    await writeNote(
      "implemented",
      "2026-01-01-zh-canonical",
      ["Status: implemented"],
      "## Decision",
      undefined,
      ["## Decision", "## Alternatives considered", "## 后果与取舍"],
    );
    expect("translated canonical heading", run(), 1, "canonical heading '## Consequences'");

    // 29. A translated bespoke heading is legal: only the canonical names are
    //     compared, so a correct translation is not rejected for translating.
    await reset();
    await writeNote(
      "implemented",
      "2026-01-01-zh-bespoke",
      ["Status: implemented"],
      "## Decision",
      undefined,
      ["## Decision", "## Alternatives considered", "## Consequences", "### 落位"],
    );
    // The English side needs the same bespoke heading for the levels to agree.
    const bespokeDir = path.join(tmp, ".agents", "notes", "implemented", "process");
    const bespokeEn = readFileSync(path.join(bespokeDir, "2026-01-01-zh-bespoke.md"), "utf8");
    await writeFile(
      path.join(bespokeDir, "2026-01-01-zh-bespoke.md"),
      `${bespokeEn}\n### Placement\n`,
    );
    expect("translated bespoke heading", run(), 0, "OK");

    // 30. The root README triplet is allowed and is not treated as a note: it
    //     has no lifecycle, class or date, and the tree's own documentation has
    //     to live somewhere.
    await reset();
    await writeNote("implemented", "2026-01-01-with-readme", ["Status: implemented"]);
    for (const name of ["README.md", "README.zh.md", "README.i18n.yaml"]) {
      await writeFile(path.join(tmp, ".agents", "notes", name), "# Agent Notes\n");
    }
    expect("root README triplet", run(), 0, "OK");

    // 31. Any other root file is still refused, so case 30 permits exactly the
    //     README triplet rather than "anything at the root".
    await reset();
    await writeNote("implemented", "2026-01-01-root-stray", ["Status: implemented"]);
    await writeFile(path.join(tmp, ".agents", "notes", "NOTES.md"), "# Notes\n");
    expect("stray root file", run(), 1, "unexpected file at tree root");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // The `--root` guard cases are shared by the gate scripts, so every copy of
  // the guard answers to one list. The defect that motivated them was several
  // copies existing with only one carrying an assertion.
  const spawnRoot = (args, env) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  const { runGuardCases } = await import("./lib/guard-cases.mjs");
  await runGuardCases({ spawnRoot, failures });

  if (failures.length) {
    for (const f of failures) console.error(`[check-notes] SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    "[check-notes] self-test passed (tree shape: illegal lifecycle, illegal class, INDEX.md at the root and in a class, orphan .zh.md, orphan .i18n.yaml, root README triplet, stray root file; header: status/dir mismatch, archived date rules, proposal-era headings, rejected reason; body: missing Problem, missing Alternatives; bilingual: heading structure, translated canonical heading, translated bespoke heading; fault cases; shared --root guard cases).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
