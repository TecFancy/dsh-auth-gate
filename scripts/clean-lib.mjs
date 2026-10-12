#!/usr/bin/env node
/**
 * Empties lib/ before a build. lib/ is a committed artifact that must equal a
 * fresh build, so every file in it has to come from the build steps; removing
 * the directory first keeps files whose sources moved or were deleted from
 * lingering. Run via `npm run build`.
 */
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(__dirname, "..", "lib");

rmSync(libDir, { recursive: true, force: true });
