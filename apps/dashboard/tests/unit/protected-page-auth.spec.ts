import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("protected page requests", () => {
  it("adds repository auth to the task helper requests", () => {
    const labelPicker = source(
      "src/dashboard/lib/components/LabelPicker.tsx",
    );
    const commentEditor = source(
      "src/dashboard/lib/components/CommentEditor.tsx",
    );

    expect(labelPicker).toContain('headers: buildHeaders()');
    expect(commentEditor).toContain(
      'fetch("/api/kody/collaborators", { headers: buildHeaders() })',
    );
  });

  it("does not start protected page queries before repository auth exists", () => {
    for (const path of [
      "src/dashboard/lib/hooks/useActivity.ts",
      "src/dashboard/lib/hooks/useActivityLog.ts",
      "src/dashboard/lib/hooks/useHealth.ts",
      "src/dashboard/features/agency/components/LoopsPage.tsx",
      "src/dashboard/lib/operators/useOperators.ts",
      "src/dashboard/lib/components/KodyDashboard.tsx",
      "src/dashboard/lib/components/AgentsControl.tsx",
    ]) {
      expect(source(path), path).toContain("useAuth()");
    }

    expect(
      source(
        "../../packages/kody-chat-dashboard/src/dashboard/lib/engine/useEngineConfig.ts",
      ),
    ).toContain("if (!auth) return");
    expect(
      source("src/dashboard/lib/components/AgentsControl.tsx"),
    ).toContain("if (!auth || !getStoredAuth()) return");
  });

  it("does not probe local machines without a user token", () => {
    expect(
      source(
        "../../packages/kody-chat-dashboard/src/dashboard/lib/chat/core/use-machine-availability.ts",
      ),
    ).toContain('requestHeaders["x-kody-token"]');
  });
});
