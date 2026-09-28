import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // Match Next/SWC's automatic JSX runtime so JSX-containing modules
  // (e.g. kody-chat-helpers.tsx) can be imported in unit tests without a
  // global `React` in scope.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    env: { CONVEX_URL: "", KODY_SERVICE_KEY: "" },
    include: ["tests/**/*.spec.ts"],
    // Playwright specs live under tests/e2e — vitest must not load them.
    exclude: ["node_modules/**", "tests/e2e/**"],
    server: {
      deps: {
        // @kody-ade/kody-chat-dashboard ships TS source — vitest must transform it
        // instead of treating it as a prebuilt external. Its @dashboard
        // imports then resolve via the aliases below, back into this repo
        // (single module instance for shared libs).
        inline: [/@kody-ade\/backend/, /@kody-ade\/kody-chat/, /@kody-ade\/base/, /@kody-ade\/workspace/, /@kody-ade\/fly/, /@kody-ade\/cms/],
      },
    },
    coverage: {
      reporter: ["text", "json", "html"],
      // Ratchet: set just below current coverage so it can only go up.
      thresholds: { lines: 56, statements: 54, branches: 43, functions: 51 },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@dashboard": resolve(__dirname, "./src/dashboard"),
      // `server-only` throws outside an RSC build — stub it so server-only
      // utilities remain unit-testable.
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
