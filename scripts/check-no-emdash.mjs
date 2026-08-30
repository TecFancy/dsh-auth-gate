#!/usr/bin/env node
/**
 * Asserts that no em-dash character (U+2014) appears anywhere in TypeScript
 * source files under src/ (the .ts and .tsx extensions). The org style rule is
 * "do not use em-dash": use a plain ASCII hyphen instead. Run via
 * `npm run lint:no-emdash`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, relative, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const srcDir = resolve(repoRoot, "src");

const EM_DASH = "\u2014";
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx"]);

function listSourceFiles(dir) {
  const entries = readdirSync(dir, { recursive: true });
  const files = [];

  for (const entry of entries) {
    const full = resolve(dir, entry);
    if (!ALLOWED_EXTENSIONS.has(extname(full))) continue;

    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;

    files.push(full);
  }

  return files;
}

const files = listSourceFiles(srcDir);
const findings = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (!content.includes(EM_DASH)) continue;

  const lines = content.split("\n");
  const relativePath = relative(srcDir, file);
  lines.forEach((line, index) => {
    if (line.includes(EM_DASH)) {
      findings.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (findings.length === 0) {
  console.log("OK: no em-dash characters found in src");
  process.exit(0);
}

console.error("FAIL: em-dash character found (use a hyphen instead):");
for (const finding of findings) {
  console.error(finding);
}
process.exit(1);
