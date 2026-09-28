import { describe, expect, it, vi } from "vitest";

import {
  createFeatureGuideRegistry,
  formatFeatureGuidePromptSection,
  type FeatureGuide,
} from "../../src/dashboard/lib/chat/platform/feature-guide-context";

const workflowsGuide: FeatureGuide = {
  id: "workflows",
  title: "Workflows",
  summary: "Build and run visual capability flows.",
  routes: ["/workflows", "/workflows/**"],
  aliases: ["workflow", "workflows"],
  body: "# Workflows\n\n## What this feature does\n\nBuild flows.",
};

describe("feature guide context", () => {
  it("delegates automatic and explicit reads to one provider", async () => {
    const registry = createFeatureGuideRegistry();
    const provider = {
      list: vi.fn(async () => [workflowsGuide]),
      read: vi.fn(async () => workflowsGuide),
      resolveForTurn: vi.fn(async () => workflowsGuide),
    };
    registry.register("dashboard-host", provider);

    await expect(
      registry.resolveForTurn({
        currentPage: "the Inbox page (/inbox)",
        userText: "Explain workflows",
      }),
    ).resolves.toEqual(workflowsGuide);
    await expect(registry.read("workflows")).resolves.toEqual(workflowsGuide);
    expect(provider.resolveForTurn).toHaveBeenCalledOnce();
    expect(provider.read).toHaveBeenCalledWith("workflows");
  });

  it("rejects duplicate providers", () => {
    const registry = createFeatureGuideRegistry();
    const provider = {
      list: async () => [],
      read: async () => null,
      resolveForTurn: async () => null,
    };
    registry.register("dashboard-host", provider);

    expect(() => registry.register("dashboard-host", provider)).toThrow(
      /already registered/i,
    );
  });

  it("formats guide knowledge without granting unavailable tools", () => {
    const section = formatFeatureGuidePromptSection(workflowsGuide);

    expect(section).toContain("Dashboard feature guide — Workflows");
    expect(section).toContain("does not grant tools or permissions");
    expect(section).toContain("current tool index and live tool results win");
    expect(section).toContain("Build flows.");
  });
});
