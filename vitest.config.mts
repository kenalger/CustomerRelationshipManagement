import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // These tests share one Postgres instance; run them serially so cleanup in
    // one file cannot delete another file's fixtures mid-run.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
