import js from "@eslint/js";
import globals from "globals";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * ESLint flat configuration for dsh-auth (a Node library plus a browser client
 * half).
 *
 * Mirrors the rsp/com baseline, minus the browser-only pieces (React, TanStack
 * Query, FSD layers, Stylelint). The complexity/length caps the reference
 * project enforces through Betterer are applied directly as rules here: the
 * repo starts below every threshold, so a fresh baseline is trivially clean.
 *
 * Two type-aware channels:
 * - node channel (main build, `*.ts`): projectService rooted at tsconfig.json;
 * - client channel (`src/client/**`, browser bundle): DOM globals, default
 *   project tsconfig.client.json.
 */
const typeCheckedExtends = [
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
];

const baseRules = {
  "import-x/order": "off",
  "no-console": "error",
  "no-nested-ternary": "error",
  // Complexity/length caps (rsp/com baseline: ADR-0012 values).
  complexity: ["error", 15],
  "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
  // Default .sort()/.toSorted() is lexicographic and unreliable outside
  // plain ASCII strings; require an explicit comparator.
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(sort|toSorted)$/][arguments.length=0]",
      message:
        "Provide a compare function to .sort()/.toSorted(): default sort is lexicographic and unreliable outside plain ASCII strings.",
    },
  ],
};

export default defineConfig([
  globalIgnores(["node_modules", "lib", "dist", "coverage"]),
  {
    files: ["**/*.ts"],
    ignores: ["src/client/**"],
    extends: typeCheckedExtends,
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import-x/resolver": {
        typescript: { project: ["./tsconfig.json"] },
      },
    },
    rules: baseRules,
  },
  // Client half (browser bundle): DOM globals, own tsconfig project. The
  // bundle deliberately imports no @deepseek-ai/* runtime values, so no
  // platform-specific rules apply beyond the shared baseline.
  {
    files: ["src/client/**/*.{ts,tsx}"],
    extends: typeCheckedExtends,
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        project: ["./tsconfig.client.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import-x/resolver": {
        typescript: { project: ["./tsconfig.client.json"] },
      },
    },
    rules: baseRules,
  },
  // Tests: identical rules, explicit vitest imports (no ambient globals needed).
  {
    files: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  // Build/config scripts are Node tooling, not shipped logic: console allowed.
  //
  // The type-aware channel above only parses `*.ts` (it is rooted at
  // tsconfig.json, which excludes JavaScript), so an `.mjs` gate script was
  // never linted at all. This block gives the JavaScript tooling the plain
  // recommended rule set. It is deliberately not type-aware: types for the
  // shared helpers come from `tsc -p tsconfig.scripts.json` (checkJs), and the
  // remaining scripts are plain ESM with no dependency on the TypeScript
  // projects.
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "*.config.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
    },
  },
  // TypeScript build/config files are covered by the type-aware channel; keep
  // the console exemption they had.
  {
    files: ["*.config.ts", "scripts/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
    },
  },
]);
