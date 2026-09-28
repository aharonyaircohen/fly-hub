import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["tests/**/*.spec.ts"],
    exclude: ["node_modules/**"],
    coverage: {
      reporter: ["text", "json", "html"],
      // Ratchet: set just below current coverage so it can only go up.
      thresholds: { lines: 25, statements: 25, branches: 7, functions: 30 },
    },
  },
  resolve: {
    alias: {
      // `server-only` throws outside an RSC build — stub it so server-only
      // utilities remain unit-testable.
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
