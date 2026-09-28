import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

describe("Views-owned Capability browser", () => {
  it("connects the mounted Views browser to both persistent Chat surfaces", () => {
    const workspace = source(
      "../../src/dashboard/features/previews/components/PreviewWorkspace.tsx",
    );
    const browser = source(
      "../../src/dashboard/features/previews/components/PreviewBrowser.tsx",
    );
    const inspector = source(
      "../../src/dashboard/lib/picker/PreviewInspector.tsx",
    );
    const rail = source("../../src/dashboard/lib/components/ChatRailShell.tsx");
    const chat = source(
      "../../../../packages/kody-chat-dashboard/src/dashboard/lib/components/KodyChat.tsx",
    );

    expect(workspace).toContain("setPreviewActionRunner");
    expect(workspace).toContain(
      "onRemoteActionRunnerChange={\n          selectedId ? setPreviewActionRunner : undefined\n        }",
    );
    expect(browser).toContain(
      "onActionRunnerChange={onRemoteActionRunnerChange}",
    );
    expect(inspector).toContain(
      "if (!remoteAct || !picker.available || !onActionRunnerChange)",
    );
    expect(inspector).toContain("registerViewsPreviewActionRunner(run)");
    expect(inspector).toContain("!onActionRunnerChange");
    expect(rail).toContain(
      "setPreviewActionRunnerState(() => normalizedRunner)",
    );
    expect(rail).toContain(
      "registeredViewsPreviewActionRunner = normalizedRunner",
    );
    expect(
      rail.match(
        /getPreviewActionRunner=\{\s*getRegisteredViewsPreviewActionRunner\s*\}/g,
      ),
    ).toHaveLength(2);
    expect(chat).toContain("getPreviewActionRunner?.()");
    expect(chat).toContain("getViewsPreviewActionRunner()");
    expect(
      rail.match(/previewActionRunner=\{previewActionRunner\}/g),
    ).toHaveLength(2);
  });
});
