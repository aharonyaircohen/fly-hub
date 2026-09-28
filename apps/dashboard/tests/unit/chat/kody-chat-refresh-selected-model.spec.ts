/**
 * Regression coverage for refresh preserving the selected Kody chat model.
 *
 * Bug: a saved per-session `kody:<model>` key was resolved before
 * /api/kody/models finished loading. The model row was not in the dropdown
 * yet, so the sync path treated it as missing, fell back to Kody Live, and
 * overwrote the session. Refresh then jumped to the default instead of the
 * selected model.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldWaitForChatCatalogResolution } from "@kody-ade/kody-chat-dashboard/platform/agent-entries";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODY_CHAT_PATH = resolve(
  __dirname,
  "../../../node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/kody-chat-selection.ts",
);
const KODY_CHAT_SOURCE = readFileSync(KODY_CHAT_PATH, "utf8");

describe("KodyChat refresh selected-model restore", () => {
  it("waits for the chat catalog before resolving a saved model pick", () => {
    expect(
      shouldWaitForChatCatalogResolution({
        sessionHydrated: false,
        chatModelsLoaded: false,
      }),
    ).toBe(true);

    expect(
      shouldWaitForChatCatalogResolution({
        sessionHydrated: true,
        chatModelsLoaded: false,
      }),
    ).toBe(true);

    expect(
      shouldWaitForChatCatalogResolution({
        sessionHydrated: true,
        chatModelsLoaded: true,
      }),
    ).toBe(false);
  });

  it("waits for the catalog before restoring any agent", () => {
    expect(
      shouldWaitForChatCatalogResolution({
        sessionHydrated: true,
        chatModelsLoaded: false,
      }),
    ).toBe(true);

    expect(
      shouldWaitForChatCatalogResolution({
        sessionHydrated: true,
        chatModelsLoaded: false,
      }),
    ).toBe(true);
  });

  it("wires the restore guard into the derived selection path", () => {
    const syncBlock = extractRegionAround(
      KODY_CHAT_SOURCE,
      "const catalogReady",
    );
    expect(syncBlock).toMatch(/shouldWaitForChatCatalogResolution/);
    expect(syncBlock).toMatch(/sessionHydrated[,\s]/);
    expect(syncBlock).toMatch(/chatModelsLoaded/);
  });

  it("keeps hydration read-only so a temporary fallback cannot poison the next refresh", () => {
    expect(KODY_CHAT_SOURCE).not.toContain(
      "setSessionAgent(activeSessionId, targetEntry.key)",
    );
  });

  it("does not consume the retired browser default owner", () => {
    expect(KODY_CHAT_SOURCE).not.toContain("readDefaultChatEntry");
  });
});

function extractRegionAround(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) return "";
  const half = 3000;
  const start = Math.max(0, idx - half);
  const end = Math.min(source.length, idx + half);
  return source.slice(start, end);
}
