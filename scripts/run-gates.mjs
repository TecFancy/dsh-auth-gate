#!/usr/bin/env node
/**
 * Run this repository's script gates from one list (`lib/gate-registry.mjs`).
 *
 * `npm run verify`, the husky pre-commit hook and `ci.yml` used to carry their
 * own hand-written copies of the gate list, so adding a gate meant editing five
 * places and nothing noticed a missed one. They now call this runner, and the
 * runner refuses to start when the list disagrees with the repository:
 *   - every registered script exists, and ids are unique;
 *   - every `scripts/check-*.mjs` and `scripts/verify-*.mjs` is registered (a
 *     new gate cannot go unseen);
 *   - every gate's `npm` script is exactly `node scripts/<script> <args>`;
 *   - `verify` calls the runner, the hook and the workflow call the runner.
 * A disagreement exits 2 before any gate runs, so drift is reported as drift and
 * never as a verdict about the tree.
 *
 * Two things this runner keeps from the design it replaces, because they are
 * worth more than uniformity with a plain registry runner:
 *
 *   1. **Change-surface scenarios.** `--scenario <name>` runs one named set, and
 *      the default run derives the set from the outgoing diff. A docs-only
 *      change must not pay for coverage and a double build; a dependency change
 *      must pay for everything. Unknown shapes fall back to the full set, never
 *      to a weaker one.
 *   2. **Run every selected gate, then report.** A commit that breaks two gates
 *      hears about both. The exit code is 2 if any gate (or the runner) hit an
 *      environment fault, else 1 if any gate found a violation, else 0.
 *
 * Usage:
 *   node scripts/run-gates.mjs                      # derive the set from the diff
 *   node scripts/run-gates.mjs --scenario hygiene   # one named set
 *   node scripts/run-gates.mjs --stage pre-commit   # the pre-commit set
 *   node scripts/run-gates.mjs --base <ref>         # also hand the baseline to gates that take one
 *   node scripts/run-gates.mjs --gate-self-tests    # every registered `--self-test`, then this runner's
 *   node scripts/run-gates.mjs --self-test          # this runner's own negative cases
 *   node scripts/run-gates.mjs --list               # the scenarios and their gates
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { GATES, RUNNER_NPM, SCENES, VERIFY_MUST_CALL, WIRING } from "./lib/gate-registry.mjs";

const TAG = "[run-gates]";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGES = ["verify", "pre-commit"];

/**
 * Change-surface rules: the first matching rule per changed file wins, and the
 * union of the matched scenes is what runs. `verify` is the fail-closed answer
 * for shapes the map does not know (dependency changes, unknown files).
 *
 * A `scripts/` change selects the self-tests too: editing a gate is the one
 * change that can silently disable it, and the map this replaces sent it to
 * `hygiene + types` only, so a broken gate stayed green.
 */
const RULES = [
  { re: /^src\//, scenes: ["hygiene", "types", "tests", "build"] },
  { re: /^test\//, scenes: ["hygiene", "types", "tests"] },
  { re: /^lib\//, scenes: ["hygiene", "build"] },
  { re: /^scripts\//, scenes: ["hygiene", "types"], selfTests: true },
  {
    re: /^(.*\.config\.(js|mjs|ts)$|aliases\.json|tsconfig.*\.json$)/,
    scenes: ["hygiene", "types"],
  },
  { re: /^(package\.json|package-lock\.json|\.npmrc)$/, scenes: ["verify"] },
  { re: /^(docs\/|AGENTS\.md|CLAUDE\.md|README\.md|README\.zh\.md|.*\.md$)/, scenes: ["hygiene"] },
  { re: /^screenshots\.json$/, scenes: ["hygiene"] },
  { re: /^\.agents\//, scenes: ["hygiene"] },
  { re: /^\./, scenes: ["hygiene"] },
  { re: /.*/, scenes: ["verify"] },
];

function parseArgs(argv) {
  const fail = (message) => {
    console.error(`${TAG} ${message}`);
    process.exit(2);
  };
  const args = {
    stage: undefined,
    base: undefined,
    scenario: undefined,
    list: false,
    gateSelfTests: false,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valueOf = (flag) => {
      const value = arg === flag ? argv[i + 1] : arg.slice(flag.length + 1);
      // A transposed flag would otherwise be taken as the value, and a value
      // that starts with `-` would reach a gate or git as an option.
      if (!value || value.startsWith("-")) fail(`${flag} needs a value`);
      if (arg === flag) i += 1;
      return value;
    };
    if (arg === "--gate-self-tests") args.gateSelfTests = true;
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--list") args.list = true;
    else if (arg === "--stage" || arg.startsWith("--stage=")) {
      if (args.stage !== undefined) fail("--stage given more than once");
      args.stage = valueOf("--stage");
      if (!STAGES.includes(args.stage)) fail(`--stage must be one of: ${STAGES.join(", ")}`);
    } else if (arg === "--scenario" || arg.startsWith("--scenario=")) {
      if (args.scenario !== undefined) fail("--scenario given more than once");
      args.scenario = valueOf("--scenario");
      if (!SCENES.includes(args.scenario) && args.scenario !== "verify") {
        fail(`--scenario must be one of: ${[...SCENES, "verify"].join(", ")}`);
      }
    } else if (arg === "--base" || arg.startsWith("--base=")) {
      if (args.base !== undefined) fail("--base given more than once");
      args.base = valueOf("--base");
    } else fail(`unknown argument: ${arg}`);
  }
  const modes = [args.gateSelfTests, args.selfTest, args.list].filter(Boolean).length;
  if (modes > 1) fail("--gate-self-tests, --self-test and --list are separate runs");
  if (modes === 1 && (args.stage !== undefined || args.base !== undefined || args.scenario)) {
    fail("a self-test or list run takes no --stage, --base or --scenario");
  }
  return args;
}

/**
 * Everything the registry must agree with, as a list of problems. Pure: the
 * caller reads the repository and passes it in, so each rule has a case in the
 * self-test that fails for exactly that rule.
 *
 * @param {object} input
 * @param {typeof GATES} input.gates
 * @param {string[]} input.checkScripts basenames of `scripts/check-*.mjs` and `scripts/verify-*.mjs`
 * @param {(name: string) => boolean} input.scriptExists
 * @param {Record<string, string>} input.npmScripts `package.json` scripts
 * @param {(file: string) => string | undefined} input.readText file text, or undefined when absent
 * @param {{file: string, contains: string}[]} input.wiring
 */
export function validateRegistry({
  gates,
  checkScripts,
  scriptExists,
  npmScripts,
  readText,
  wiring,
}) {
  const problems = [];
  const seen = new Set();
  for (const gate of gates) {
    if (seen.has(gate.id)) problems.push(`duplicate gate id: ${gate.id}`);
    seen.add(gate.id);
    if (gate.script === undefined && gate.command === undefined) {
      problems.push(`${gate.id}: needs either a script or a command`);
    }
    if (gate.script !== undefined && gate.command !== undefined) {
      problems.push(`${gate.id}: has both a script and a command; pick one`);
    }
    if (gate.script !== undefined && !scriptExists(gate.script)) {
      problems.push(`${gate.id}: scripts/${gate.script} does not exist`);
    }
    for (const stage of gate.stages) {
      if (!STAGES.includes(stage)) problems.push(`${gate.id}: unknown stage "${stage}"`);
    }
    for (const scene of gate.scenes) {
      if (!SCENES.includes(scene)) problems.push(`${gate.id}: unknown scene "${scene}"`);
    }
    if (gate.stagedPattern && !gate.stages.includes("pre-commit")) {
      problems.push(`${gate.id}: stagedPattern is only meaningful in the pre-commit stage`);
    }
    // A script that is neither a gate nor explained is a script nobody runs.
    if (gate.stages.length === 0 && !gate.manualReason) {
      problems.push(`${gate.id}: no stages, so it needs a manualReason saying why`);
    }
    if (gate.stages.length > 0 && gate.manualReason) {
      problems.push(`${gate.id}: has stages, so manualReason does not apply`);
    }
    if (gate.npm) {
      const expected =
        gate.command !== undefined
          ? gate.command
          : ["node", `scripts/${gate.script}`, ...gate.args].join(" ");
      if (npmScripts[gate.npm] !== expected) {
        problems.push(
          `${gate.id}: npm script "${gate.npm}" is ${JSON.stringify(npmScripts[gate.npm])}, expected ${JSON.stringify(expected)}`,
        );
      }
    }
  }
  // A command gate may name a script inside its command (`node scripts/x.mjs`),
  // so the registered set is the script fields plus every `scripts/*.mjs` a
  // command mentions. Without that, moving a gate from `script` to `command`
  // would make its file look unregistered.
  const registered = new Set(gates.map((g) => g.script).filter((s) => s !== undefined));
  for (const gate of gates) {
    if (gate.command === undefined) continue;
    for (const m of gate.command.matchAll(/scripts\/([\w.-]+\.mjs)/g)) registered.add(m[1]);
  }
  for (const file of checkScripts) {
    if (!registered.has(file)) {
      problems.push(
        `scripts/${file} is not in scripts/lib/gate-registry.mjs; register it, with stages [] and a manualReason if it is a report`,
      );
    }
  }
  for (const [name, command] of Object.entries(RUNNER_NPM)) {
    if (npmScripts[name] !== command) {
      problems.push(
        `npm script "${name}" is ${JSON.stringify(npmScripts[name])}, expected ${JSON.stringify(command)}`,
      );
    }
  }
  for (const call of VERIFY_MUST_CALL) {
    if (!(npmScripts.verify ?? "").includes(call))
      problems.push(`npm script "verify" does not call "${call}"`);
  }
  for (const { file, contains } of wiring) {
    const text = readText(file);
    if (text === undefined) problems.push(`${file} is missing; it must contain "${contains}"`);
    else if (!text.includes(contains)) problems.push(`${file} does not contain "${contains}"`);
  }
  return problems;
}

/** The gates one stage runs, in registry order. */
export function selectGates(gates, { stage, staged = [] }) {
  return gates.filter((gate) => {
    if (!gate.stages.includes(stage)) return false;
    if (stage !== "pre-commit" || !gate.stagedPattern) return true;
    return staged.some((file) => gate.stagedPattern.test(file));
  });
}

/** The gates one scenario runs, in registry order. `verify` is every gate with a stage. */
export function gatesForScenario(gates, scenario) {
  if (scenario === "verify") return gates.filter((g) => g.stages.length > 0);
  return gates.filter((g) => g.scenes.includes(scenario));
}

/**
 * How one gate runs. A script gate is `node scripts/<script> <args>`; a command
 * gate is its npm command, run through the shell. `base` is appended to a
 * script gate that takes one, and to a command gate as `-- --base <ref>`.
 */
export function commandFor(gate, { base } = {}) {
  if (gate.command !== undefined) {
    return { command: gate.command, base: gate.takesBase ? base : undefined };
  }
  const args = [path.join("scripts", gate.script), ...gate.args];
  if (base !== undefined && gate.takesBase) args.push("--base", base);
  return { args };
}

/** 2 wins over 1: an incomplete answer is not a verdict. */
export function exitCodeFor(results) {
  if (results.some((r) => r.code !== 0 && r.code !== 1)) return 2;
  return results.some((r) => r.code === 1) ? 1 : 0;
}

/**
 * Run every command, none skipped after a failure. `spawn(args)` returns the
 * child's exit status, or null when it died on a signal or never started, which
 * counts as a fault (2) and never as success.
 */
export function runAll(plan, spawn, log = () => {}) {
  const results = [];
  for (const entry of plan) {
    const { id } = entry;
    log(`${TAG} > ${id}: ${entry.command ?? `node ${entry.args.join(" ")}`}`);
    const status = spawn(entry);
    results.push({ id, code: typeof status === "number" ? status : 2 });
  }
  return results;
}

/**
 * The scenes a changed-file list selects, plus whether the self-tests are owed.
 * Pure, so the fallback rules have cases in the self-test.
 */
export function scenesFor(files) {
  const scenes = new Set();
  let selfTests = false;
  for (const file of files) {
    const rule = RULES.find((r) => r.re.test(file));
    for (const scene of rule.scenes) scenes.add(scene);
    if (rule.selfTests) selfTests = true;
  }
  return { scenes: [...scenes], selfTests };
}

function realSpawn(entry) {
  // No stdin for the child. `check-bilingual.mjs` reads its corpus from stdin to
  // honour a fixture's file list, so a child that inherited an open pipe (a
  // background shell, a CI wrapper) would wait for an EOF that never comes.
  const stdio = ["ignore", "inherit", "inherit"];
  if (entry.command !== undefined) {
    const full =
      entry.base === undefined ? entry.command : `${entry.command} -- --base ${entry.base}`;
    // A command gate runs a package binary (`tsc`, `eslint`, `steiger`), and
    // those live in node_modules/.bin. npm puts that directory on PATH for its
    // own scripts; a runner invoked directly does not, so it is prepended here.
    const bin = path.join(REPO_ROOT, "node_modules", ".bin");
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
    return spawnSync(full, { cwd: REPO_ROOT, stdio, shell: true, env }).status;
  }
  return spawnSync(process.execPath, entry.args, { cwd: REPO_ROOT, stdio }).status;
}

function readRepoText(file) {
  try {
    return readFileSync(path.join(REPO_ROOT, file), "utf8");
  } catch {
    return undefined;
  }
}

function registryProblems() {
  let npmScripts;
  try {
    npmScripts = JSON.parse(readRepoText("package.json") ?? "").scripts ?? {};
  } catch {
    return ["package.json is missing or is not valid JSON"];
  }
  return validateRegistry({
    gates: GATES,
    checkScripts: readdirSync(path.join(REPO_ROOT, "scripts")).filter((f) =>
      /^(check|verify)-.*\.mjs$/.test(f),
    ),
    scriptExists: (name) => existsSync(path.join(REPO_ROOT, "scripts", name)),
    npmScripts,
    readText: readRepoText,
    wiring: WIRING,
  });
}

function stagedPaths() {
  const result = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`${TAG} cannot list staged files: ${(result.stderr || "git failed").trim()}`);
    process.exit(2);
  }
  return result.stdout.split("\n").filter(Boolean);
}

/**
 * The changed files since `base`, including untracked ones. `git diff` never
 * lists an untracked file, so a new `src/` file would otherwise skip type-check
 * and tests entirely. Returns null when this is not a git checkout.
 */
function changedFiles(base) {
  let tracked = null;
  for (const candidate of [base, "HEAD"]) {
    const result = spawnSync("git", ["diff", "--name-only", candidate], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (result.status === 0) {
      tracked = result.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      break;
    }
  }
  if (tracked === null) return null;
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const untracked =
    status.status === 0
      ? status.stdout
          .split("\n")
          .filter((line) => line.startsWith("?? "))
          .map((line) => line.slice(3))
          .filter(Boolean)
      : [];
  return [...new Set([...tracked, ...untracked])];
}

function report(results) {
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length === 0) {
    console.log(`${TAG} OK - ${results.length} gate(s) passed.`);
    return;
  }
  const label = (r) => `${r.id} (${r.code === 1 ? "violations" : "fault"})`;
  console.error(`${TAG} FAILED: ${failed.map(label).join(", ")}`);
}

function selfTestPlan() {
  const plan = GATES.filter((g) => g.selfTest).map((g) => ({
    id: `${g.id} self-test`,
    args: [path.join("scripts", g.script), "--self-test"],
  }));
  plan.push({
    id: "run-gates self-test",
    args: [path.join("scripts", "run-gates.mjs"), "--self-test"],
  });
  return plan;
}

function printList() {
  console.log("Scenarios (named gate sets, derived from scripts/lib/gate-registry.mjs):\n");
  for (const scene of [...SCENES, "verify"]) {
    const ids = gatesForScenario(GATES, scene).map((g) => g.id);
    console.log(`  ${scene.padEnd(8)} ${ids.join(", ") || "(none)"}`);
  }
  console.log(
    "\nUsage: node scripts/run-gates.mjs [--scenario <name>] [--stage <name>] [--base <ref>]",
  );
  console.log("  default: derive the scenario set from the change surface against HEAD");
  console.log(
    "  --stage pre-commit: the hook's set (stagedPattern gates only when their paths are staged)",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  if (args.list) return printList();

  const problems = registryProblems();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${TAG} REGISTRY: ${problem}`);
    console.error(
      `${TAG} the gate list disagrees with the repository; fix it before any gate runs.`,
    );
    process.exit(2);
  }

  if (args.gateSelfTests) {
    const results = runAll(selfTestPlan(), realSpawn, console.log);
    report(results);
    process.exit(exitCodeFor(results));
  }

  if (args.stage !== undefined) {
    const needsStaged = args.stage === "pre-commit" && GATES.some((g) => g.stagedPattern);
    const selected = selectGates(GATES, {
      stage: args.stage,
      staged: needsStaged ? stagedPaths() : [],
    });
    const results = runAll(
      selected.map((g) => ({ id: g.id, ...commandFor(g, { base: args.base }) })),
      realSpawn,
      console.log,
    );
    report(results);
    process.exit(exitCodeFor(results));
  }

  if (args.scenario !== undefined) {
    const selected = gatesForScenario(GATES, args.scenario);
    const results = runAll(
      selected.map((g) => ({ id: g.id, ...commandFor(g, { base: args.base }) })),
      realSpawn,
      console.log,
    );
    report(results);
    process.exit(exitCodeFor(results));
  }

  // Default: derive the set from the change surface.
  const files = changedFiles(args.base ?? "HEAD");
  if (files === null) {
    console.error(`${TAG} not a git checkout - pass --scenario <name> explicitly (see --list).`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.log(`${TAG} no changes since the base - running the hygiene scenario.`);
    const results = runAll(
      gatesForScenario(GATES, "hygiene").map((g) => ({ id: g.id, ...commandFor(g) })),
      realSpawn,
      console.log,
    );
    report(results);
    process.exit(exitCodeFor(results));
  }

  const { scenes, selfTests } = scenesFor(files);
  const full = scenes.includes("verify");
  const selected = full
    ? gatesForScenario(GATES, "verify")
    : [...new Set(scenes.flatMap((s) => gatesForScenario(GATES, s)))];
  const plan = selected.map((g) => ({ id: g.id, ...commandFor(g, { base: args.base }) }));
  if (selfTests) plan.push(...selfTestPlan());
  console.log(
    `${TAG} ${files.length} changed file(s) -> scenes: ${scenes.join(", ")}` +
      (full ? " (full set)" : "") +
      (selfTests ? " + gate self-tests" : ""),
  );
  const results = runAll(plan, realSpawn, console.log);
  report(results);
  process.exit(exitCodeFor(results));
}

/** Negative cases: each registry rule, the selection rules, and the aggregation. */
async function selfTest() {
  const failures = [];
  const expect = (cond, label) => {
    if (!cond) failures.push(label);
  };

  const g = (over) => ({
    id: "x",
    script: "check-x.mjs",
    args: [],
    scenes: ["hygiene"],
    stages: ["verify"],
    selfTest: true,
    ...over,
  });
  const base = () => ({
    gates: [g({ npm: "x:check" })],
    checkScripts: ["check-x.mjs"],
    scriptExists: () => true,
    npmScripts: {
      "x:check": "node scripts/check-x.mjs",
      ...RUNNER_NPM,
      verify: VERIFY_MUST_CALL.join(" && "),
    },
    readText: (file) =>
      WIRING.filter((w) => w.file === file)
        .map((w) => w.contains)
        .join("\n"),
    wiring: WIRING,
  });
  const problemsOf = (over) => validateRegistry({ ...base(), ...over });
  expect(
    problemsOf({}).length === 0,
    `a consistent registry reported: ${problemsOf({}).join("; ")}`,
  );
  const has = (list, needle) => list.some((p) => p.includes(needle));

  expect(has(problemsOf({ gates: [g(), g()] }), "duplicate gate id"), "duplicate id");
  expect(has(problemsOf({ scriptExists: () => false }), "does not exist"), "missing script file");
  expect(
    has(problemsOf({ gates: [g({ stages: ["nightly"] })] }), "unknown stage"),
    "unknown stage",
  );
  expect(
    has(problemsOf({ gates: [g({ scenes: ["nightly"] })] }), "unknown scene"),
    "unknown scene",
  );
  expect(
    has(problemsOf({ gates: [g({ stagedPattern: /a/ })] }), "stagedPattern"),
    "stagedPattern outside pre-commit",
  );
  expect(
    has(problemsOf({ gates: [g({ stages: [] })] }), "needs a manualReason"),
    "a gate with no stage and no reason",
  );
  expect(
    has(
      problemsOf({ gates: [g({ stages: [], manualReason: "why" })] }),
      "manualReason does not apply",
    ) === false,
    "a manual gate with a reason is accepted",
  );
  expect(
    has(
      problemsOf({ checkScripts: ["check-x.mjs", "verify-new.mjs"] }),
      "verify-new.mjs is not in",
    ),
    "an unregistered verify script",
  );
  expect(
    has(problemsOf({ gates: [g({ npm: "x:check", args: ["--y"] })] }), 'npm script "x:check"'),
    "npm script out of step with args",
  );
  expect(
    has(problemsOf({ gates: [g({ npm: "x:missing" })] }), 'npm script "x:missing"'),
    "a registered npm script that does not exist",
  );
  expect(
    has(
      problemsOf({ npmScripts: { ...base().npmScripts, "gates:check": "echo" } }),
      'npm script "gates:check"',
    ),
    "runner npm script",
  );
  expect(
    has(
      problemsOf({ npmScripts: { ...base().npmScripts, verify: "npm run lint" } }),
      'does not call "npm run gates:check"',
    ),
    "verify not calling the runner",
  );
  expect(
    has(problemsOf({ readText: () => undefined }), "is missing"),
    "a wiring file that is absent",
  );
  expect(
    has(problemsOf({ readText: () => "node scripts/check-bilingual.mjs\n" }), "does not contain"),
    "a hook edited back to a hand list",
  );

  // Stage selection.
  const set = [
    g({ id: "a", stages: ["verify", "pre-commit"] }),
    g({ id: "b", stages: ["verify"] }),
    g({ id: "c", stages: ["verify", "pre-commit"], stagedPattern: /^skills\// }),
    g({ id: "d", stages: [], manualReason: "report" }),
  ];
  const ids = (list) => list.map((x) => x.id).join(",");
  expect(
    ids(selectGates(set, { stage: "verify" })) === "a,b,c",
    "verify runs every verify gate, staged or not",
  );
  expect(
    ids(selectGates(set, { stage: "pre-commit", staged: [] })) === "a",
    "pre-commit skips a gate whose paths are not staged",
  );
  expect(
    ids(selectGates(set, { stage: "pre-commit", staged: ["skills/x/SKILL.md"] })) === "a,c",
    "pre-commit runs a gate whose paths are staged",
  );
  expect(
    ids(selectGates(set, { stage: "verify" })).includes("d") === false,
    "a gate with no stage never runs as a gate",
  );

  // Scenario selection.
  const sceneSet = [
    g({ id: "h", scenes: ["hygiene"] }),
    g({ id: "t", scenes: ["types"] }),
    g({ id: "b2", scenes: ["build"] }),
    g({ id: "m", scenes: [], stages: [], manualReason: "report" }),
  ];
  expect(ids(gatesForScenario(sceneSet, "hygiene")) === "h", "a scene selects its own gates");
  expect(
    ids(gatesForScenario(sceneSet, "verify")) === "h,t,b2",
    "the verify scenario is every gate with a stage",
  );
  expect(
    ids(gatesForScenario(sceneSet, "verify")).includes("m") === false,
    "a manual gate is in no scenario",
  );

  // Change-surface derivation.
  expect(scenesFor(["docs/x.md"]).scenes.join(",") === "hygiene", "a docs change is hygiene only");
  expect(
    scenesFor(["src/index.ts"]).scenes.join(",") === "hygiene,types,tests,build",
    "a src change is everything",
  );
  expect(scenesFor(["scripts/check-x.mjs"]).selfTests, "a scripts change owes the self-tests");
  expect(
    scenesFor(["scripts/check-x.mjs"]).scenes.join(",") === "hygiene,types",
    "a scripts change keeps its scenes",
  );
  expect(
    scenesFor(["package.json"]).scenes.join(",") === "verify",
    "a dependency change falls back to the full set",
  );
  expect(
    scenesFor(["something-unknown.xyz"]).scenes.join(",") === "verify",
    "an unknown file falls back to the full set",
  );
  expect(
    scenesFor([".agents/skills/x/SKILL.md"]).scenes.join(",") === "hygiene",
    "a skill change is hygiene",
  );

  // Command line.
  const sealed = g({ takesBase: true, args: ["--w"] });
  expect(
    commandFor(sealed, { base: "abc" }).args.join(" ").endsWith("--w --base abc"),
    "base is handed to a script gate that takes one",
  );
  expect(
    !commandFor(g(), { base: "abc" }).args.includes("--base"),
    "base is withheld from a gate that does not",
  );
  expect(!commandFor(sealed).args.includes("--base"), "no base given, none passed");

  // A command gate runs its npm command, not a script path.
  const cmd = g({ script: undefined, command: "npm run lint", npm: "lint", args: undefined });
  expect(commandFor(cmd).command === "npm run lint", "a command gate runs its command");
  expect(commandFor(cmd).args === undefined, "a command gate has no node args");
  expect(
    commandFor({ ...cmd, takesBase: true }, { base: "abc" }).base === "abc",
    "a command gate that takes a base receives it",
  );
  expect(
    commandFor({ ...cmd, takesBase: false }, { base: "abc" }).base === undefined,
    "a command gate that does not take a base withholds it",
  );
  expect(
    has(problemsOf({ gates: [g({ script: undefined, command: undefined })] }), "needs either"),
    "a gate with neither a script nor a command",
  );
  expect(
    has(problemsOf({ gates: [g({ command: "npm run lint" })] }), "has both a script and a command"),
    "a gate with both a script and a command",
  );

  // Aggregation.
  const seenIds = [];
  const results = runAll(
    [
      { id: "p", args: ["p"] },
      { id: "q", args: ["q"] },
      { id: "r", args: ["r"] },
    ],
    (entry) => {
      seenIds.push(entry.id);
      return entry.id === "p" ? 1 : 0;
    },
  );
  expect(seenIds.join("") === "pqr", "a failing gate does not stop the rest");
  expect(
    runAll([{ id: "c", command: "npm run lint" }], (e) => (e.command === "npm run lint" ? 0 : 1))
      .length === 1,
    "a command gate reaches the spawner with its command",
  );
  expect(exitCodeFor(results) === 1, "violations exit 1");
  expect(
    exitCodeFor(runAll([{ id: "s", args: ["s"] }], () => null)) === 2,
    "a signalled or unstarted gate is a fault",
  );
  expect(
    exitCodeFor(runAll([{ id: "s", args: ["s"] }], () => 3)) === 2,
    "an unexpected exit status is a fault",
  );
  expect(exitCodeFor([{ code: 1 }, { code: 2 }]) === 2, "a fault wins over violations");
  expect(exitCodeFor([]) === 0, "no gates exits 0");

  // The real registry must agree with the real repository: this is the case that
  // fails when a gate is added to one place and not the others.
  const live = registryProblems();
  expect(live.length === 0, `the live registry disagrees with the repository: ${live.join("; ")}`);

  // Argument handling runs in a child so process.exit does not end this test.
  const child = (a) =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...a], { encoding: "utf8" });
  expect(child(["--nope"]).status === 2, "unknown argument exits 2");
  expect(child(["--stage", "nightly"]).status === 2, "unknown stage exits 2");
  expect(child(["--stage"]).status === 2, "--stage without a value exits 2");
  expect(child(["--scenario", "nightly"]).status === 2, "unknown scenario exits 2");
  expect(child(["--base", "--stage"]).status === 2, "a flag taken as a --base value exits 2");
  expect(
    child(["--self-test", "--stage", "verify"]).status === 2,
    "--self-test takes no other arguments",
  );
  expect(
    child(["--self-test", "--gate-self-tests"]).status === 2,
    "the two self-test modes are exclusive",
  );

  if (failures.length) {
    for (const failure of failures) console.error(`${TAG} SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `${TAG} self-test passed (registry rules, stage and scenario selection, change-surface derivation, base forwarding, run-all aggregation and fault precedence, live registry, argument guards).`,
  );
}

await main();
