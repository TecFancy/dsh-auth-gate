#!/usr/bin/env node
/**
 * Verifies the few source-tree boundaries that Steiger cannot see (D29). Everything
 * Feature-Sliced Design itself prescribes (layer order, same-layer isolation, public API
 * entry through `index.ts`, `@x` cross-imports, naming) is Steiger's job: `npm run lint:fsd`
 * runs it over `src/host`. This script only keeps what lies outside the analysed trees:
 *
 *   1. Half isolation. `src/client/**` and the host half (`src/host/**` plus the root files
 *      directly under `src/`) never import each other, in either direction.
 *   2. Barrel-only entry. A root file (anything directly under `src/`, entry points, wiring
 *      and their tests) may enter `src/host/` only through a slice or segment `index.ts`:
 *      `src/host/{entities,features}/<slice>/index.ts` or `src/host/shared/<segment>/index.ts`.
 *   3. Fail-closed resolution. A relative import that cannot be resolved to a file fails: an
 *      unknown shape must never pass the gate silently. Imports that resolve outside `src/`
 *      (the shared `test/` harness) are leaves and are allowed.
 *   4. No stray files. Every `.ts`/`.tsx` file under `src/` is a root file, lies under
 *      `src/host/{shared,entities,features}/`, or lies under `src/client/`; anything else
 *      (for example a leftover `src/gate/` or a file directly in `src/host/`) fails.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src");
const CODE_EXT = /\.(ts|tsx)$/;
const HOST_LAYERS = /^host\/(shared|entities|features)\//;
/** The only host files a root file may import: a slice or a shared-segment barrel. */
const HOST_BARREL = /^host\/(?:(?:entities|features)\/[^/]+|shared\/[^/]+)\/index\.ts$/;
/** `from "./x"`, bare `import "./x"`, `import("./x")` and `vi.mock("./x")` specifiers. */
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*|\bvi\.mock\(\s*)"(\.[^"]+)"/g;
const errors = [];

const toPosix = (p) => p.split(sep).join("/");

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectFiles(full, out);
    } else if (CODE_EXT.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Which tree a src-relative path belongs to, or null for a stray file. */
function zoneOf(rel) {
  if (!rel.includes("/")) return "root";
  if (rel.startsWith("client/")) return "client";
  if (HOST_LAYERS.test(rel)) return "host";
  return null;
}

/** Resolve a relative specifier to a src-relative file path; null when it does not resolve. */
function resolveTarget(parentRel, spec) {
  const base = toPosix(join(dirname(parentRel), spec).replace(/\.(js|ts|tsx)$/, ""));
  return ["", ".ts", ".tsx"].map((e) => base + e).find((p) => isFile(join(SRC_DIR, p))) ?? null;
}

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

/** An import that lands outside `src/` on an existing file (the `test/` harness leaf). */
function isOutsideLeaf(parentRel, spec) {
  const abs = join(dirname(join(SRC_DIR, parentRel)), spec).replace(/\.(js|ts|tsx)$/, "");
  if (!relative(SRC_DIR, abs).startsWith("..")) return false;
  return [".ts", ".tsx"].some((e) => isFile(abs + e));
}

for (const file of collectFiles(SRC_DIR)) {
  const rel = toPosix(relative(SRC_DIR, file));
  const fromZone = zoneOf(rel);
  if (fromZone === null) {
    errors.push(
      `${rel}: 不在允许的位置（只能是 src/ 根文件、src/host/{shared,entities,features}/ 或 src/client/）`,
    );
    continue;
  }
  const text = readFileSync(file, "utf8");
  for (const [, spec] of text.matchAll(SPECIFIER)) {
    if (isOutsideLeaf(rel, spec)) continue;
    const targetRel = resolveTarget(rel, spec);
    if (targetRel === null) {
      errors.push(`${rel}: import "${spec}" 无法解析到 src 下的文件（fail-closed）`);
      continue;
    }
    const toZone = zoneOf(targetRel);
    if (toZone === null) {
      errors.push(`${rel}: import "${spec}" 落入不允许的位置 ${targetRel}`);
      continue;
    }
    if ((fromZone === "client") !== (toZone === "client")) {
      errors.push(`${rel}: client 半区与 host 半区禁止互引（${targetRel}）`);
      continue;
    }
    if (fromZone === "root" && toZone === "host" && !HOST_BARREL.test(targetRel)) {
      errors.push(
        `${rel}: 根文件进入 src/host 必须经 slice 或 shared 段的 index.ts（当前指向 ${targetRel}）`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("slice:check FAILED");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}
console.log(
  "OK: client/host halves isolated, root files enter src/host only through index.ts, no stray files",
);
