import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.spec.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.spec.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          name: "smoke",
          include: ["tests/smoke/**/*.spec.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.spec.ts"],
          environment: "node",
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["convex/**/*.ts", "src/**/*.ts"],
      exclude: ["convex/_generated/**"],
    },
  },
})
