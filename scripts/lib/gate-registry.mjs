/**
 * The one list of this repository's script gates.
 *
 * Before this file, a gate was named in five places that had to agree: its own
 * npm script, the `verify` chain, the `gates:self-test` chain, the husky
 * pre-commit hook and `ci.yml`. Adding a gate meant editing all five by hand,
 * and nothing noticed when one was missed. `run-gates.mjs` now derives the
 * `verify`, pre-commit and self-test runs from this list, and refuses to run
 * when the list disagrees with the files on disk, the npm scripts, or the hook
 * and workflow that must call the runner.
 *
 * Entry fields:
 *   id             stable name shown in the runner's output.
 *   script         file under `scripts/`.
 *   args           arguments of a normal (checking) run.
 *   npm            the npm script that runs exactly `node scripts/<script> <args>`;
 *                  omit it for a script that has none.
 *   scenes         which change-surface scenarios this gate belongs to:
 *                  `hygiene` (fast, no build), `types`, `tests`, `build`.
 *                  A gate in no scene is only reachable through `verify`.
 *   stages         where a checking run belongs: `verify` (the full gate and CI)
 *                  and/or `pre-commit`. An empty list is a script that is only
 *                  self-tested here: a report or a generator, not a gate. Every
 *                  `scripts/check-*.mjs` and `scripts/verify-*.mjs` must be
 *                  registered, so a new gate that nobody wired in fails the
 *                  runner instead of passing unseen.
 *   selfTest       whether `<script> --self-test` exists and runs in
 *                  `gates:self-test`.
 *   stagedPattern  pre-commit only: run the gate when a staged path matches. A
 *                  gate without it runs on every commit.
 *   takesBase      accepts `--base <ref>` and receives the runner's `--base`.
 *   manualReason   why this gate cannot run unconditionally in CI. Present only
 *                  on a gate with no `stages`, and required there: a script that
 *                  is neither a gate nor explained is a script nobody runs.
 */

export const GATES = [
  {
    id: "skills-mirror",
    script: "sync-skills.mjs",
    args: ["--check"],
    npm: "skills:check",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
    // The mirror is generated and gitignored, so only these two paths can leave
    // it out of step. Run the check when the sources that produce it are staged.
    stagedPattern: /^(\.agents\/skills\/|scripts\/sync-skills\.mjs$)/,
  },
  {
    id: "skills-frontmatter",
    script: "check-skill-frontmatter.mjs",
    args: [],
    npm: "skills:frontmatter",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
    // The mirror is a byte copy, so it would carry an unloadable block through.
    stagedPattern: /^(\.agents\/skills\/|scripts\/sync-skills\.mjs$)/,
  },
  {
    id: "skills-links",
    script: "check-skill-links.mjs",
    args: [],
    npm: "skills:links",
    scenes: ["hygiene"],
    // No stagedPattern: a skill links out to AGENTS.md and docs/, so a commit
    // that renames one of those breaks a skill without staging any skill file.
    stages: ["verify", "pre-commit"],
    selfTest: true,
  },
  {
    id: "no-emdash",
    script: "check-no-emdash.mjs",
    args: [],
    npm: "lint:no-emdash",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
  },
  {
    id: "docs-links",
    script: "check-docs.mjs",
    args: [],
    npm: "docs:check",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
  },
  {
    // No stagedPattern: the budgets sit on files any commit can touch, and the
    // gate reads two files.
    id: "doc-budgets",
    script: "check-doc-budgets.mjs",
    args: [],
    npm: "docs:budgets",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
  },
  {
    id: "bilingual",
    script: "check-bilingual.mjs",
    args: [],
    npm: "bilingual:check",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
    // The KNOWN_DRIFT list is compared against the list at the base, so the
    // gate needs the baseline the runner was given. Without it the comparison
    // falls back to HEAD, which already contains the change under test.
    takesBase: true,
  },
  {
    id: "notes",
    script: "check-notes.mjs",
    args: [],
    npm: "notes:check",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
  },
  {
    id: "note-links",
    script: "check-note-links.mjs",
    args: [],
    npm: "notes:links",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
  },
  {
    id: "archives",
    script: "check-archives.mjs",
    args: [],
    npm: "archives:check",
    scenes: ["hygiene"],
    stages: ["verify", "pre-commit"],
    selfTest: true,
    takesBase: true,
  },
  {
    // A report for now, not a gate: the rule set is calibrated but the existing
    // corpus has 319 findings, and making it blocking today would mean either
    // rewriting 38 documents in a structural refactor or lowering the rule.
    // Run `npm run zh:prose -- --status` to see the backlog; promote it to a
    // gate (stages: ["verify", "pre-commit"]) once the corpus is clean.
    id: "zh-prose",
    script: "check-zh-prose.mjs",
    args: [],
    npm: "zh:prose",
    scenes: [],
    stages: [],
    selfTest: true,
    manualReason: "report: 319 existing findings; promote to a gate once the corpus is clean",
  },
  {
    id: "slice-boundaries",
    script: "verify-slice-boundaries.mjs",
    args: [],
    npm: "slice:check",
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "lockfile-registry",
    script: "check-lockfile-registry.mjs",
    args: [],
    npm: "lock:check",
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "readme-parity",
    script: "verify-readme-parity.mjs",
    args: [],
    npm: "readme:parity",
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "screenshots",
    script: "verify-screenshots.mjs",
    args: [],
    npm: "screenshots:check",
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "build",
    command: "node scripts/clean-lib.mjs && tsc -p tsconfig.build.json && tsdown && tsc -p tsconfig.client.build.json",
    npm: "build",
    scenes: ["build"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "bundle",
    script: "verify-bundle.mjs",
    args: [],
    npm: "bundle:check",
    scenes: ["build"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    // The npm script runs the self-test and then the check, so this is a
    // command gate rather than a script gate: registering only the script would
    // drop the self-test half.
    id: "host-contract",
    command: "node scripts/check-host.mjs --self-test && node scripts/check-host.mjs",
    npm: "host:check",
    scenes: ["build"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    // Live-entry coverage probes a real running host, so it cannot be a CI step.
    // It is registered here so the runner knows it exists and why it is manual.
    id: "live-entries",
    script: "check-live-entries.mjs",
    args: [],
    scenes: [],
    stages: [],
    selfTest: false,
    manualReason: "probes a real running dsh host; needs a deployed instance and credentials",
  },
  // npm commands, not script gates. They are registered here for the same
  // reason the script gates are: `verify`, the change-surface scenarios and
  // the CI job all derive their step list from this one file, so a step that
  // is missing here is a step nobody runs.
  {
    id: "format",
    command: "prettier --check .",
    npm: "format:check",
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "lint",
    command: "eslint .",
    npm: "lint",
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "fsd-layering",
    command: "steiger src/host && steiger src/client",
    npm: "lint:fsd",
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "type-check",
    command:
      "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit && tsc -p tsconfig.scripts.json",
    npm: "type-check",
    scenes: ["types"],
    stages: ["verify"],
    selfTest: false,
  },
  {
    id: "tests",
    command: "vitest run --coverage",
    npm: "test:coverage",
    scenes: ["tests"],
    stages: ["verify"],
    selfTest: false,
  },
];

/**
 * Files that must call the runner. A gate that is registered but whose caller
 * was edited back to a hand-written list is a gate that stops running; each
 * entry names the text that proves the caller still goes through the runner.
 */
export const WIRING = [
  { file: ".husky/pre-commit", contains: "node scripts/run-gates.mjs --stage pre-commit" },
  { file: ".github/workflows/ci.yml", contains: "npm run gates:check" },
  { file: ".github/workflows/ci.yml", contains: "npm run gates:self-test" },
];

/** The npm scripts that expose the runner, and what `verify` must call. */
export const RUNNER_NPM = {
  "gates:check": "node scripts/run-gates.mjs",
  "gates:self-test": "node scripts/run-gates.mjs --gate-self-tests",
};
export const VERIFY_MUST_CALL = ["npm run gates:check", "npm run gates:self-test"];

/** The scenario names a change surface can select. */
export const SCENES = ["hygiene", "types", "tests", "build"];
