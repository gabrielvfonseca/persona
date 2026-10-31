import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Root tests run against the workspace sources, not built output, so a failing
// cross-package test points at the code that changed. Each package and example
// keeps its own tests and runs them with its own vitest config.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@persona\/(?<g1>core|schemas|memory|policy|persona|learning|postgres|whatsapp)$/u,
        replacement: src("./packages/$1/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
