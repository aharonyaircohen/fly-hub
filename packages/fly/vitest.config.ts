import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    exclude: ["node_modules/**"],
  },
  resolve: {
    alias: {
      // `server-only` throws outside an RSC build — stub it so server-only
      // utilities remain unit-testable.
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
