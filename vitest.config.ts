import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * Node library: node environment, explicit vitest imports (no globals), v8
 * coverage with the same 80% red line as the rsp/com baseline. Test timeouts
 * are bumped to 10s so cold-start imports under parallel load (Windows + AV
 * scans, fresh CI runners) don't trip false-positive timeouts.
 *
 * Per-path floors sit above the global 80% red line on the security-critical
 * slices. The global line can stay green while one of those files quietly loses
 * its tests; these blocks make that file's own drop fail the run. Each floor is
 * just below the coverage measured on the current tree (guard: 91.2% lines /
 * 82.0% branches / 88.2% functions; session: 100% / 100% / 100%; password:
 * 99.1% lines / 94.2% branches / 98.8% functions) so the gate ratchets rather
 * than fails, and the gap is headroom for ordinary refactors, not for deleting
 * a test. Raise a floor when the measured value rises; never lower one to make
 * a red run green.
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
        // The guard core: fail-closed decisions, route wrapping, rollback.
        "src/host/shared/guard/**": {
          branches: 81,
          functions: 87,
          lines: 90,
        },
        // Session issue/validation/revocation.
        "src/host/entities/session/**": {
          branches: 95,
          functions: 95,
          lines: 95,
        },
        // Password verification, change flow, TOTP stage.
        "src/host/features/password/**": {
          branches: 93,
          functions: 97,
          lines: 98,
        },
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
