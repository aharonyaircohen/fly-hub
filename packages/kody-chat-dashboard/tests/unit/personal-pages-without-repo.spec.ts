import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PERSONAL_MANAGERS = [
  "src/dashboard/lib/components/CommandsManager.tsx",
  "src/dashboard/lib/components/InstructionsManager.tsx",
  "src/dashboard/lib/components/SecretsManager.tsx",
  "src/dashboard/lib/components/ViewRenderersManager.tsx",
  "src/dashboard/lib/components/WidgetsManager.tsx",
] as const;

const PERSONAL_PAGES = [
  "src/dashboard/lib/pages/commands.tsx",
  "src/dashboard/lib/pages/instructions.tsx",
  "src/dashboard/lib/pages/guided-flows.tsx",
  "src/dashboard/lib/pages/view-renderers.tsx",
  "src/dashboard/lib/pages/view-renderer-detail.tsx",
  "src/dashboard/lib/pages/widgets.tsx",
  "src/dashboard/lib/pages/widget-detail.tsx",
  "src/dashboard/lib/chat/plugins/commands-page/panel.tsx",
  "src/dashboard/lib/chat/plugins/instructions/panel.tsx",
] as const;

describe("personal Chat pages", () => {
  it("does not require repository authentication", () => {
    for (const path of [...PERSONAL_MANAGERS, ...PERSONAL_PAGES]) {
      expect(readFileSync(path, "utf8"), path).not.toContain("AuthGuard");
    }
  });

  it("loads personal data when repository context is absent", () => {
    for (const path of PERSONAL_MANAGERS) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("enabled: !!auth");
    }
  });
});
