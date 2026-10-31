import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
    },
    environment: "node",
    // The tests share one database and truncate it, so files must not overlap.
    fileParallelism: false,
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
