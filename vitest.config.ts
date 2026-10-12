import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * Node library: node environment, explicit vitest imports (no globals), v8
 * coverage with the same 80% red line as the rsp/com baseline. Test timeouts
 * are bumped to 10s so cold-start imports under parallel load (Windows + AV
 * scans, fresh CI runners) don't trip false-positive timeouts.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
