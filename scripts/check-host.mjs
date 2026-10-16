#!/usr/bin/env node
/**
 * Host-contract gate (`npm run host:check`): the facts the dsh host relies on that no type
 * checker sees, because each lives in a different file and none is derived from another.
 *
 *   1. Identity. `package.json#name`, the Loader row in `cordis.patch.yml` (`id` and `name`),
 *      the client bundle's `__ModuleLoader__.load({ id })` and the host entry's exported
 *      `name` are one string.
 *   2. Manifest targets. Every path `main`, `types`, `bin`, `exports` and `files` point at exists
 *      after a build, and `dsh.bundle.patch` / `dsh.client.platform` hold their fixed values.
 *   3. Module table. Every `require("...")` in `lib/client.js`, and every entry of
 *      `CLIENT_EXTERNALS` in `tsdown.config.ts`, is a module the dsh shell seeds. A request the
 *      table cannot answer is a guaranteed runtime throw in the browser, so it fails here.
 *   4. Routes (D31). No route literal outside `src/protocol/`; every `{ kind, path }`
 *      registration names a protocol constant; every protocol path is registered somewhere; and
 *      every `/auth/...` path the two READMEs mention exists.
 *
 * The host corridor (`engines.dsh` versus the storage-domain peer) is not repeated here: it is
 * locked by `src/host-corridor.test.ts`.
 *
 * Usage:
 *   node scripts/check-host.mjs                 # check this repository (needs a fresh build)
 *   node scripts/check-host.mjs --root <dir>    # check another tree
 *   node scripts/check-host.mjs --self-test     # prove every rule still fails on a broken tree
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The modules the dsh web shell seeds into its frozen module table. Mirrors `PLATFORM_MODULES`
 * in dsh `packages/client/web/src/platform.ts` (the shell's single source for seeding, externals
 * and aliases); update both together when the host changes it. The copy is tracked as debt in
 * `.rsp/TechDebt.md`.
 */
const HOST_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit",
];
/**
 * A route literal inside a string: right after the opening quote (`"/auth/login"`), after an
 * interpolation (`` `${origin}/auth/status` ``) or after a host (`"https://h/auth"`).
 */
const ROUTE_LITERAL = /(?:["'`}]|\w)\/auth(?=["'`/?#])/;
/**
 * A route object: `{ kind: "exact" | "prefix", ..., path: X }`, properties in any order. The kind
 * value must end the property (`,` or `}`), so type literals such as
 * `{ kind: "exact" | "prefix"; path: string }` are not mistaken for registrations.
 */
const ROUTE_OBJECT = /\{[^{}]*\bkind:\s*"(exact|prefix)"\s*(?=[,}])[^{}]*\}/g;
const ROUTE_OBJECT_PATH = /\bpath:\s*([^,}\s]+)/;
/** A route path in README prose (not a file path such as `~/.dsh/auth/users.yaml`). */
const README_ROUTE = /(?<![\w.~/-])\/auth(?:\/[a-z][a-z-]*)*/g;

const toPosix = (p) => p.split(sep).join("/");

/** Every `.ts`/`.tsx` file under `dir`, except tests. */
function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function makeContext(root) {
  const problems = [];
  const read = (rel) => {
    const path = join(root, rel);
    if (existsSync(path)) return readFileSync(path, "utf8");
    problems.push(`${rel} 不存在`);
    return "";
  };
  const expect = (condition, message) => {
    if (!condition) problems.push(message);
  };
  const manifest = JSON.parse(read("package.json") || "{}");
  return { root, problems, read, expect, manifest, clientBundle: read("lib/client.js") };
}

function checkIdentity({ read, expect, manifest, clientBundle }) {
  const name = manifest.name;
  const patch = read("cordis.patch.yml");
  const ids = [...patch.matchAll(/^\s*-?\s*id:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  const names = [...patch.matchAll(/^\s*name:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  expect(ids.length > 0, "cordis.patch.yml 里没有 Loader 行（id）");
  for (const id of ids) expect(id === name, `cordis.patch.yml 的行 id ${id} 与包名 ${name} 不一致`);
  for (const rowName of names) {
    expect(rowName === name, `cordis.patch.yml 的行 name ${rowName} 与包名 ${name} 不一致`);
  }
  const registration = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(clientBundle);
  expect(registration !== null, "lib/client.js 里找不到 __ModuleLoader__.load 注册");
  if (registration !== null) {
    expect(registration[1] === name, `客户端注册 id ${registration[1]} 与包名 ${name} 不一致`);
  }
  const hostName = /export const name = "([^"]+)"/.exec(read(manifest.main ?? "lib/index.js"));
  expect(hostName?.[1] === name, `host 入口导出的 name 与包名 ${name} 不一致`);
  expect(
    manifest.dsh?.bundle?.patch === "./cordis.patch.yml",
    "package.json#dsh.bundle.patch 必须是 ./cordis.patch.yml",
  );
  expect(manifest.dsh?.client?.platform === "web", "package.json#dsh.client.platform 必须是 web");
}

/** Every file path the manifest promises, as repository-relative strings. */
function manifestTargets(manifest) {
  const targets = [manifest.main, manifest.types, ...Object.values(manifest.bin ?? {})];
  for (const entry of Object.values(manifest.exports ?? {})) {
    if (typeof entry === "string") targets.push(entry);
    else targets.push(...Object.values(entry ?? {}));
  }
  return [...targets, ...(manifest.files ?? [])]
    .filter((target) => typeof target === "string")
    .map((target) => target.replace(/^\.\//, ""));
}

/** Whether a manifest path exists; a `*` in the last segment needs at least one match. */
function targetExists(root, target) {
  if (!target.includes("*")) return existsSync(join(root, target));
  const dir = join(root, dirname(target));
  const pattern = new RegExp(
    `^${target.split("/").pop().replace(/\./g, "\\.").replace(/\*/g, ".*")}$`,
  );
  return existsSync(dir) && readdirSync(dir).some((file) => pattern.test(file));
}

function checkManifestTargets({ root, expect, manifest }) {
  for (const target of new Set(manifestTargets(manifest))) {
    expect(
      targetExists(root, target),
      `package.json 指向的 ${target} 不存在（先跑 npm run build）`,
    );
  }
}

function checkModuleTable({ read, expect, manifest, clientBundle }) {
  const allowed = new Set([...HOST_MODULES, ...(manifest.dsh?.client?.external ?? [])]);
  const externalsSource = /const CLIENT_EXTERNALS = \[([^\]]*)\]/.exec(read("tsdown.config.ts"));
  expect(externalsSource !== null, "tsdown.config.ts 里找不到 CLIENT_EXTERNALS");
  const externals = [...(externalsSource?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const external of externals) {
    expect(
      allowed.has(external),
      `tsdown.config.ts 把 ${external} 外部化了，宿主模块表里没有这个模块`,
    );
  }
  const requested = new Set([...clientBundle.matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1]));
  for (const specifier of requested) {
    expect(
      allowed.has(specifier),
      `lib/client.js 向模块表要了 ${specifier}，宿主模块表里没有这个模块`,
    );
    expect(
      externals.includes(specifier),
      `lib/client.js 要了 ${specifier}，它不在 CLIENT_EXTERNALS 里`,
    );
  }
  return requested;
}

/** Route path constants of the contract: name → value. */
function protocolPaths(read) {
  const source = read("src/protocol/index.ts");
  const entries = [...source.matchAll(/export const (\w+) = "(\/auth[^"]*)";/g)].map((m) => [
    m[1],
    m[2],
  ]);
  return new Map(entries.filter(([name]) => name.endsWith("_PATH") || name === "AUTH_PATH_PREFIX"));
}

/**
 * Code lines of one file, comment lines dropped (a path in prose is not a literal). Heuristic by
 * design: a line counts as a comment when it starts with `*`, `/*` or `//`, so a trailing
 * `// "/auth"` on a code line is still reported, and a template-literal line that happens to start
 * with `*` is skipped. Neither shape exists in this tree; the self-test pins the common cases.
 */
function codeLines(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*(\*|\/\*|\/\/)/.test(line));
}

function checkRoutes({ root, read, expect }) {
  const paths = protocolPaths(read);
  expect(paths.size > 0, "src/protocol/index.ts 里没有路由路径常量");
  const files = sourceFiles(join(root, "src")).filter(
    (f) => !toPosix(relative(root, f)).startsWith("src/protocol/"),
  );
  const registered = new Set();
  for (const file of files) {
    const rel = toPosix(relative(root, file));
    for (const { line, number } of codeLines(file)) {
      expect(
        !ROUTE_LITERAL.test(line),
        `${rel}:${number} 写了路由字面量，改用 src/protocol 的常量`,
      );
    }
    for (const [block, kind] of readFileSync(file, "utf8").matchAll(ROUTE_OBJECT)) {
      const token = ROUTE_OBJECT_PATH.exec(block)?.[1] ?? "(none)";
      const value = paths.get(token);
      expect(
        value !== undefined,
        `${rel} 注册的 ${kind} 路由 ${token} 不是 src/protocol 的路径常量`,
      );
      if (value !== undefined) registered.add(value);
    }
  }
  for (const [name, value] of paths) {
    expect(registered.has(value), `src/protocol 的 ${name}（${value}）没有任何注册`);
  }
  const known = new Set(paths.values());
  for (const readme of ["README.md", "README.zh.md"]) {
    for (const [mention] of read(readme).matchAll(README_ROUTE)) {
      expect(known.has(mention), `${readme} 提到的 ${mention} 不是 src/protocol 里的路径`);
    }
  }
  return registered;
}

/** Run every rule over one tree; returns the problems and a short summary. */
function checkHost(root) {
  const context = makeContext(root);
  checkIdentity(context);
  checkManifestTargets(context);
  const requested = checkModuleTable(context);
  const registered = checkRoutes(context);
  return { problems: context.problems, requested, registered };
}

/** A minimal tree that passes every rule; self-test cases break one fact each. */
const FIXTURE = {
  "package.json": JSON.stringify({
    name: "fx-plugin",
    main: "lib/index.js",
    types: "lib/index.d.ts",
    bin: { fx: "lib/cli.js" },
    exports: {
      ".": { types: "./lib/index.d.ts", default: "./lib/index.js" },
      "./package.json": "./package.json",
    },
    files: ["lib", "cordis.patch.yml", "locale/*.json"],
    dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
  }),
  "cordis.patch.yml": '- insert:\n    - id: fx-plugin\n      name: "fx-plugin"\n',
  "tsdown.config.ts": 'const CLIENT_EXTERNALS = ["react", "react/jsx-runtime"];\n',
  "lib/index.js": 'export const name = "fx-plugin";\n',
  "lib/index.d.ts": "",
  "lib/cli.js": "",
  "lib/client.js":
    'window.__ModuleLoader__.load({\n\tid: "fx-plugin",\n\tfactory: (require) => { require("react"); }\n});\n',
  "locale/en.json": "{}",
  "src/protocol/index.ts":
    'export const AUTH_PATH_PREFIX = "/auth";\nexport const LOGIN_PATH = "/auth/login";\n',
  "src/host/endpoints.ts":
    '// registers "/auth/login"\ntype Route = { kind: "exact" | "prefix"; path: string };\ntrack({ kind: "prefix", path: AUTH_PATH_PREFIX });\ntrack({ kind: "exact", path: LOGIN_PATH });\n',
  "src/client/index.tsx": "fetch(LOGIN_PATH);\n",
  "README.md": "POST `/auth/login`, users in `~/.dsh/auth/users.yaml`.\n",
  "README.zh.md": "POST `/auth/login`。\n",
};

const append = (rel, text) => (files) => ({ ...files, [rel]: files[rel] + text });
const replace = (rel, from, to) => (files) => ({ ...files, [rel]: files[rel].replace(from, to) });

const SELF_TEST_CASES = [
  [
    "client registration id drifts",
    replace("lib/client.js", 'id: "fx-plugin"', 'id: "other"'),
    "客户端注册 id",
  ],
  [
    "Loader row id drifts",
    replace("cordis.patch.yml", "id: fx-plugin", "id: other"),
    "cordis.patch.yml 的行 id",
  ],
  ["host entry name drifts", replace("lib/index.js", "fx-plugin", "other"), "host 入口导出的 name"],
  ["bin target missing", (files) => ({ ...files, "lib/cli.js": undefined }), "lib/cli.js 不存在"],
  [
    "bundle asks for an unseeded module",
    replace("lib/client.js", 'require("react");', 'require("node:fs");'),
    "宿主模块表里没有",
  ],
  [
    "route literal in code",
    append("src/client/index.tsx", 'fetch("/auth/status");\n'),
    "写了路由字面量",
  ],
  [
    "registration without a constant",
    append("src/host/endpoints.ts", 'track({ kind: "exact", path: OTHER });\n'),
    "不是 src/protocol 的路径常量",
  ],
  [
    "contract path never registered",
    append("src/protocol/index.ts", 'export const STATUS_PATH = "/auth/status";\n'),
    "没有任何注册",
  ],
  [
    "README names an unknown route",
    append("README.zh.md", "GET `/auth/nope`\n"),
    "README.zh.md 提到的 /auth/nope",
  ],
  [
    "Loader row name drifts",
    replace("cordis.patch.yml", 'name: "fx-plugin"', 'name: "other"'),
    "cordis.patch.yml 的行 name",
  ],
  [
    "bundle patch path changes",
    replace("package.json", '"patch":"./cordis.patch.yml"', '"patch":"./other.yml"'),
    "dsh.bundle.patch",
  ],
  [
    "client platform changes",
    replace("package.json", '"platform":"web"', '"platform":"desktop"'),
    "dsh.client.platform",
  ],
  [
    "a glob target matches nothing",
    (files) => ({ ...files, "locale/en.json": undefined }),
    "locale/*.json 不存在",
  ],
  ["a README is missing", (files) => ({ ...files, "README.md": undefined }), "README.md 不存在"],
  [
    "tsdown externalises an unseeded module",
    replace("tsdown.config.ts", '"react/jsx-runtime"]', '"react/jsx-runtime", "lodash"]'),
    "tsdown.config.ts 把 lodash 外部化了",
  ],
  [
    "bundle asks for a seeded module it does not externalise",
    replace("lib/client.js", 'require("react");', 'require("react"); require("react-dom");'),
    "react-dom，它不在 CLIENT_EXTERNALS 里",
  ],
  [
    "route literal after an interpolation",
    append("src/client/index.tsx", "fetch(`${origin}/auth/status`);\n"),
    "写了路由字面量",
  ],
  [
    "registration with path before kind",
    append("src/host/endpoints.ts", 'track({ path: OTHER, kind: "exact" });\n'),
    "路由 OTHER 不是 src/protocol 的路径常量",
  ],
];

function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

/** Each case must fail with its own message; the untouched fixture must pass. */
function selfTest() {
  const failures = [];
  const run = (mutate) => {
    const dir = mkdtempSync(join(tmpdir(), "check-host-"));
    try {
      writeTree(dir, mutate(FIXTURE));
      return checkHost(dir).problems;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const baseline = run((files) => files);
  if (baseline.length > 0) failures.push(`baseline fixture should pass: ${baseline.join("; ")}`);
  for (const [label, mutate, needle] of SELF_TEST_CASES) {
    const problems = run(mutate);
    if (!problems.some((problem) => problem.includes(needle))) {
      failures.push(
        `${label}: expected a problem containing "${needle}", got [${problems.join("; ")}]`,
      );
    }
  }
  if (failures.length > 0) {
    console.error("host:check self-test FAILED");
    for (const failure of failures) console.error("  - " + failure);
    process.exit(1);
  }
  console.log(
    `OK: host:check self-test (${SELF_TEST_CASES.length} broken trees rejected, baseline passes)`,
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  const rootAt = argv.indexOf("--root");
  const root =
    rootAt === -1 ? join(dirname(fileURLToPath(import.meta.url)), "..") : argv[rootAt + 1];
  if (root === undefined || root.startsWith("--")) {
    console.error("usage: node scripts/check-host.mjs [--root <dir>] | --self-test");
    process.exit(2);
  }
  const { problems, requested, registered } = checkHost(root);
  if (problems.length > 0) {
    console.error(`host:check FAILED (${problems.length})`);
    for (const problem of problems) console.error("  - " + problem);
    process.exit(1);
  }
  console.log(
    `OK: host contract holds (identity, manifest targets, module table: ${[...requested].join(", ") || "none"}, ${registered.size} protocol routes registered)`,
  );
}

main();
