import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("rate limit polling guardrails", () => {
  it("keeps the first six hot internal pages on slower or cached paths", () => {
    expect(
      source("src/dashboard/features/previews/components/FlyPreviewsList.tsx"),
    ).toContain("const REFRESH_MS = 60_000");
    expect(
      source(
        "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/chat/plugins/terminal/use-brain-image-save.ts",
      ),
    ).toContain("const BRAIN_IMAGE_SAVE_POLL_INTERVAL_MS = 10_000");
    expect(
      source("src/dashboard/features/admin/components/BrainImagesManager.tsx"),
    ).toContain("/api/kody/brain/image?jobId=");
    expect(
      source(
        "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/chat/plugins/terminal/useChatTerminalRegistry.ts",
      ),
    ).not.toContain("refreshStatus");
    expect(source("src/dashboard/lib/hooks/useAgencyRuns.ts")).toContain(
      "const AGENCY_RUNS_REFETCH_MS = 120_000",
    );
    // Agency model reads stay behind authenticated server routes. Their
    // bounded polling avoids exposing the backend service key to the browser.
  });

  it("uses server-side caches for expensive repeated reads", () => {
    expect(source("../../packages/brain/src/image-catalog.ts")).toContain(
      "discoveredImagesCache.get",
    );
    expect(
      source(
        "node_modules/@kody-ade/fly/src/plugin/runners/inventory-server.ts",
      ),
    ).toContain("listFlyInventoryCached");
    const brainImageManagement = source(
      "../../packages/brain/src/image-management.ts",
    );
    expect(
      brainImageManagement.indexOf("getTerminalBridgeExecJob"),
    ).toBeLessThan(brainImageManagement.indexOf("refresh: true"));
  });
});
