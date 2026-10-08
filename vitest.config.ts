import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The live tests cost tokens, so they run only through `npm run test:e2e`, which sets
    // JEV_CODE_E2E=1; excluding them unconditionally left that script with no files to run.
    exclude: process.env.JEV_CODE_E2E === "1" ? [] : ["tests/e2e/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/index.ts", "src/**/types.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
