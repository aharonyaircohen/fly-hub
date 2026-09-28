import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/features/admin/components/CapabilitiesManager.tsx",
  "utf8",
);
const shell = readFileSync(
  "src/dashboard/lib/components/ChatRailShell.tsx",
  "utf8",
);

describe("CapabilitiesManager trust control", () => {
  it("does not expose runnable trust on capability details", () => {
    expect(source).not.toContain("TrustLevelControl");
    expect(source).not.toContain("trustLevelForCapability");
    expect(source).not.toContain('trustSubjectKey("capability"');
    expect(source).not.toContain("trust.setTrustLevel");
    expect(source).not.toContain("capability: selected.slug");
  });

  it("uses the shared file manager instead of a capability-specific editor", () => {
    expect(source).toContain("FilesPage");
    expect(source).toContain("FilesTransport");
    expect(source).toContain('"@dashboard/features/file-manager"');
    expect(source).toContain("<DashboardFilesPage");
    expect(source).not.toContain("function CapabilityForm");
    expect(source).not.toContain("function AssetEditor");
    expect(source).not.toContain("function ContractEditor");
    expect(source).not.toContain("function FileItem");
    expect(source).not.toContain("function FolderItems");
  });

  it("keeps the simple capability folder in the shared workspace", () => {
    expect(source).toContain("const root = detail.slug");
    for (const entry of [
      "instructions.md",
      "contract.json",
      "skills",
      "tools",
    ]) {
      expect(source).toContain(entry);
    }
  });

  it("keeps the capability route owned by the file workspace", () => {
    expect(shell).not.toContain("capabilitiesChatPlugin");
    expect(shell).not.toContain('"/capabilities": CAPABILITIES_PANEL_ID');
    expect(
      existsSync("src/dashboard/lib/chat/plugins/capabilities/index.ts"),
    ).toBe(false);
    expect(
      existsSync("src/dashboard/lib/chat/plugins/capabilities/panel.tsx"),
    ).toBe(false);
  });

  it("keeps old capability detail routes as thin file-workspace adapters", () => {
    for (const path of [
      "app/(chat-rail)/capabilities/[slug]/page.tsx",
      "app/(chat-rail)/capabilities/[slug]/edit/page.tsx",
      "app/(chat-rail)/capabilities/[slug]/files/[[...path]]/page.tsx",
    ]) {
      const route = readFileSync(path, "utf8");
      expect(route, path).toContain("CapabilitiesWorkspace");
      expect(route, path).not.toContain("<CapabilitiesManager");
      expect(route, path).not.toContain("CapabilityEditorPage");
    }
  });

  it("does not keep legacy capability workspace wrappers", () => {
    expect(source).not.toContain("export function CapabilitiesManager");
    expect(source).not.toContain("export function CapabilityWorkspace");
    expect(source).not.toContain("if (slug)");
  });
});
