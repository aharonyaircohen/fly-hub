import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatFeatureGuidePromptSection } from "@kody-ade/kody-chat-dashboard/platform/feature-guide-context";
import { getFeatureGuideRegistry } from "@kody-ade/kody-chat-dashboard/platform/server-feature-guides";

const dashboardRoot = resolve(import.meta.dirname, "../..");

describe("feature guide runtime wiring", () => {
  it("gives Kody the actual SSH download flow through its registered guide", async () => {
    await import("../../app/api/kody/chat/kody/dashboard-feature-guides");
    const guide = await getFeatureGuideRegistry().resolveForTurn({
      currentPage: "the Chat page (/chat)",
      userText: "How do I download SSH config?",
    });
    expect(guide?.id).toBe("previews");
    const prompt = formatFeatureGuidePromptSection(guide!);
    expect(prompt).toContain("Download SSH config");
    expect(prompt).toContain("configured during creation");
    expect(prompt).toContain(
      "Downloading alone does not install settings on the Mac",
    );
    expect(prompt).toContain("never paste it into chat");
  });
  it("resolves and formats the real workflows guide through the registered provider", async () => {
    await import("../../app/api/kody/chat/kody/dashboard-feature-guides");

    const guide = await getFeatureGuideRegistry().resolveForTurn({
      currentPage: "the Inbox page (/inbox)",
      userText: "How do workflow approvals work?",
    });

    expect(guide?.id).toBe("workflows");
    expect(formatFeatureGuidePromptSection(guide!)).toContain(
      "Store Workflows cannot be edited",
    );
  });

  it("registers the Dashboard guide provider before the package route loads", () => {
    const wrapper = readFileSync(
      resolve(dashboardRoot, "app/api/kody/chat/kody/route.ts"),
      "utf8",
    );

    expect(wrapper).toContain('import "./dashboard-feature-guides"');
  });

  it("ships Markdown guides with the server route", () => {
    const config = readFileSync(
      resolve(dashboardRoot, "next.config.mjs"),
      "utf8",
    );

    expect(config).toContain("outputFileTracingIncludes");
    expect(config).toContain("src/dashboard/features/**/guide.md");
    expect(config).toContain('"/api/kody/chat/brain"');
    expect(config).toContain('"/api/kody/chat/brain-fly"');
  });

  it("adds the automatically resolved guide to the shared Agent prompt", () => {
    const route = readFileSync(
      resolve(
        dashboardRoot,
        "../../packages/kody-chat-dashboard/app/api/kody/chat/kody/route.ts",
      ),
      "utf8",
    );

    expect(route).toContain("resolveForTurn");
    expect(route).toContain("formatFeatureGuidePromptSection");
    expect(route).toContain("featureGuidePromptSection");
  });
});
