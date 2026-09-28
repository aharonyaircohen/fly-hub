import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/ModelsManager.tsx",
  "utf8",
);

describe("ModelsManager model editor dialog", () => {
  it("explains that the chat default applies to new conversations", () => {
    expect(SOURCE).toContain("Used for new conversations");
    expect(SOURCE).not.toContain("Auto-selected when chat opens");
    expect(SOURCE).not.toContain("auto-selected on open");
  });

  it("uses the shared wide viewport modal behavior", () => {
    const editorDialog = SOURCE.slice(
      SOURCE.indexOf("function ModelEditor"),
      SOURCE.length,
    );

    expect(editorDialog).toContain('modalSize="wide"');
    expect(editorDialog).toContain('modalHeight="viewport"');
    expect(editorDialog).toContain(
      'className="mt-2 flex min-h-0 min-w-0 flex-col gap-3 overflow-visible"',
    );
    expect(editorDialog).not.toContain('className="max-w-md"');
  });

  it("keeps model service management in one optional section", () => {
    expect(SOURCE).toContain("Service");
    expect(SOURCE).toContain("Start command");
    expect(SOURCE).toContain("Stop command");
    expect(SOURCE).toContain('<option value="local">Local</option>');
    expect(SOURCE).toContain('<option value="brain">Brain</option>');
    expect(SOURCE).toContain("Start service");
    expect(SOURCE).toContain("Stop service");
    expect(SOURCE).toContain("Service status:");
    expect(SOURCE).toContain('action: "status"');
    expect(SOURCE).toContain('m.service?.machine === "local"');
    expect(SOURCE).toContain("Checking service…");
    expect(SOURCE).not.toContain("Local Mac");
  });

  it("keeps personal model edits and local services usable without repository auth", () => {
    expect(SOURCE).toContain('if (auth && scope === "personal") {');
    expect(SOURCE).toContain('fetch("/api/kody/model-services"');
    expect(SOURCE).toContain('(m.service.machine === "brain" && !auth)');
    expect(SOURCE).not.toContain("disabled={serviceBusy !== null || !auth}");
  });

  it("lets repository users switch between personal and shared model settings", () => {
    expect(SOURCE).toContain("Personal");
    expect(SOURCE).toContain("Repository");
    expect(SOURCE).toContain('"/api/kody/repository-models"');
  });
});
