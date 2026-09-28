import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createFileFeatureGuideProvider,
  REQUIRED_FEATURE_GUIDE_HEADINGS,
} from "@dashboard/lib/feature-guides/server";

const provider = createFileFeatureGuideProvider({
  rootDirectory: resolve(import.meta.dirname, "../../src/dashboard/features"),
});
const repositoryRoot = resolve(import.meta.dirname, "../../../..");

const EXPECTED_GUIDE_IDS = [
  "admin",
  "agency",
  "engine-setup",
  "file-manager",
  "file-spaces",
  "inbox",
  "memory",
  "messages",
  "onboarding",
  "previews",
  "tasks",
  "vibe",
  "workflows",
] as const;

describe("dashboard feature guides", () => {
  it("covers every non-empty Dashboard feature folder", async () => {
    const guides = await provider.list();

    expect(guides.map((guide) => guide.id).sort()).toEqual(
      [...EXPECTED_GUIDE_IDS].sort(),
    );
    for (const guide of guides) {
      for (const heading of REQUIRED_FEATURE_GUIDE_HEADINGS) {
        expect(guide.body).toContain(`## ${heading}`);
      }
      const unsupported = guide.body.match(
        /## What will not work\n\n([\s\S]*?)\n\n## Known limitations/,
      )?.[1];
      expect(unsupported?.length).toBeGreaterThan(100);

      const sources = [
        ...guide.body
          .split("## Authoritative sources")[1]!
          .matchAll(/^- `([^`]+)`$/gm),
      ].map((match) => match[1]!);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(existsSync(resolve(repositoryRoot, source)), source).toBe(true);
      }
    }
  });

  it("reads a complete workflows guide without exposing its frontmatter", async () => {
    const guide = await provider.read("workflows");

    expect(guide).not.toBeNull();
    expect(guide?.id).toBe("workflows");
    expect(guide?.routes).toContain("/workflows/**");
    expect(guide?.body).not.toContain("---");
    for (const heading of REQUIRED_FEATURE_GUIDE_HEADINGS) {
      expect(guide?.body).toContain(`## ${heading}`);
    }
  });

  it("selects workflows from the current page", async () => {
    const guide = await provider.resolveForTurn({
      currentPage: "the Workflows page (/workflows/weekly-review)",
      userText: "What can I do here?",
    });

    expect(guide?.id).toBe("workflows");
  });

  it("prefers a feature explicitly named in the question over the current page", async () => {
    const guide = await provider.resolveForTurn({
      currentPage: "the Inbox page (/inbox)",
      userText: "How do workflow approvals work?",
    });

    expect(guide?.id).toBe("workflows");
  });

  it("routes explicit browser work to Views even from Connections", async () => {
    const guide = await provider.resolveForTurn({
      currentPage: "the Connections page (/connections)",
      userText: "i want to use browser to post",
    });

    expect(guide?.id).toBe("previews");
    expect(guide?.body).toContain(
      "Connections does not create or authorize a browser session",
    );
    expect(guide?.body).toContain(
      "Never invent a browser connection option or claim an action completed",
    );
  });

  it("documents Connections separately from approved publishing Workflows", async () => {
    const guide = await provider.resolveForTurn({
      currentPage: "the Connections page (/connections)",
      userText: "How do I configure a Facebook Page API connection?",
    });

    expect(guide?.id).toBe("admin");
    expect(guide?.body).toContain("Instagram Creator and Business publishing");
    expect(guide?.body).toContain("after explicit approval");
    expect(guide?.body).toContain("Connections do not create browser sessions");
  });

  it("recognizes every guide by its stable id", async () => {
    for (const id of EXPECTED_GUIDE_IDS) {
      const guide = await provider.resolveForTurn({
        currentPage: "the Chat page (/chat)",
        userText: `Tell me about ${id}`,
      });
      expect(guide?.id, id).toBe(id);
    }
  });

  it("matches dynamic Task detail routes", async () => {
    const guide = await provider.resolveForTurn({
      currentPage: "the Tasks page (/repo/acme/app/42)",
      userText: "What can I do here?",
    });

    expect(guide?.id).toBe("tasks");
  });

  it("prefers the most specific page guide over a broad admin route", async () => {
    const guide = await provider.resolveForTurn({
      currentPage: "the Previews page (/fly/previews)",
      userText: "What can I do here?",
    });

    expect(guide?.id).toBe("previews");
  });

  it("returns null when neither the question nor page identifies a guide", async () => {
    await expect(
      provider.resolveForTurn({
        currentPage: "the Chat page (/chat)",
        userText: "Hello",
      }),
    ).resolves.toBeNull();
  });

  it("does not allow arbitrary file reads through guide ids", async () => {
    await expect(provider.read("../../package.json")).resolves.toBeNull();
  });
});
