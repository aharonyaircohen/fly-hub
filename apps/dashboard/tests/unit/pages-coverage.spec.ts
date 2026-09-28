/**
 * @fileoverview Every canonical shared page shipped by @kody-ade/kody-chat-dashboard
 * (pages/*) must be served by this app via a route file that re-exports it.
 * Adding a page to the package without registering a dash route fails here
 * with the missing path.
 * @testFramework vitest
 * @domain pages
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Canonical page module -> this app's route file. */
const ROUTE_FOR: Record<string, string> = {
  apps: "app/apps/layout.tsx",
  brain: "app/(chat-rail)/brain/page.tsx",
  "guided-flows": "app/(chat-rail)/guided-flows/page.tsx",
  models: "app/(chat-rail)/models/page.tsx",
  "repository-models": "app/(chat-rail)/repository-models/page.tsx",
  secrets: "app/(chat-rail)/secrets/page.tsx",
  brands: "app/(chat-rail)/brands/page.tsx",
  "brand-detail": "app/(chat-rail)/brands/[slug]/page.tsx",
  commands: "app/(chat-rail)/commands/page.tsx",
  instructions: "app/(chat-rail)/instructions/page.tsx",
  "view-renderers": "app/(chat-rail)/views/renderers/page.tsx",
  "view-renderer-detail": "app/(chat-rail)/views/renderers/[slug]/page.tsx",
  widgets: "app/(chat-rail)/views/widgets/page.tsx",
  "widget-detail": "app/(chat-rail)/views/widgets/[slug]/page.tsx",
  snippets: "app/(chat-rail)/snippets/page.tsx",
  triggers: "app/(chat-rail)/triggers/page.tsx",
  "user-journeys": "app/(chat-rail)/user-journeys/page.tsx",
  "quality-actions": "app/(chat-rail)/quality/actions/page.tsx",
  "quality-journeys": "app/(chat-rail)/quality/journeys/page.tsx",
  "quality-scenarios": "app/(chat-rail)/quality/scenarios/page.tsx",
  "quality-runs": "app/(chat-rail)/quality/runs/page.tsx",
};

const PAGES_DIR = join(
  process.cwd(),
  "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/pages",
);

/**
 * Package pages the dashboard intentionally serves with its OWN
 * implementation instead of the canonical re-export (the package page
 * remains for the standalone harness). Route must still exist.
 */
const DASH_OWNED_OVERRIDES: Record<string, string> = {
  context: "app/(chat-rail)/context/page.tsx",
  "context-detail": "app/(chat-rail)/context/[...path]/page.tsx",
  memory: "app/(chat-rail)/memory-files/[[...path]]/page.tsx",
  "memory-detail": "app/(chat-rail)/memory-files/[[...path]]/page.tsx",
};

describe("shared pages route coverage", () => {
  const pages = readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""));

  it("every canonical package page has a dash route mapping", () => {
    for (const page of pages) {
      expect(
        ROUTE_FOR[page] ?? DASH_OWNED_OVERRIDES[page],
        `add a dash route mapping for pages/${page}`,
      ).toBeTruthy();
    }
  });

  it("every dash-owned override route exists", () => {
    for (const route of Object.values(DASH_OWNED_OVERRIDES)) {
      expect(
        existsSync(join(process.cwd(), route)),
        `${route} is missing`,
      ).toBe(true);
    }
  });

  it("every route file exists and re-exports its canonical page", () => {
    for (const [page, route] of Object.entries(ROUTE_FOR)) {
      const abs = join(process.cwd(), route);
      expect(existsSync(abs), `${route} is missing`).toBe(true);
      expect(
        readFileSync(abs, "utf8"),
        `${route} must re-export @kody-ade/kody-chat-dashboard/pages/${page}`,
      ).toContain(`@kody-ade/kody-chat-dashboard/pages/${page}"`);
    }
  });
});
