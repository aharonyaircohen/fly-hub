/**
 * Built-in default renderers: shipped with the package, overridable by
 * backend files with the same slug.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_VIEW_RENDERER_DEFINITIONS,
  getBuiltinViewRendererDefinition,
} from "@dashboard/lib/view-renderers/builtin";
import { buildChatViewCatalog } from "@dashboard/lib/view-renderers/spec/catalog";

describe("builtin view renderers", () => {
  it("ships the default renderers, validated", () => {
    expect(BUILTIN_VIEW_RENDERER_DEFINITIONS.map((d) => d.slug).sort()).toEqual(
      [
        "approval-card",
        "guided-flow-command",
        "guided-flow-status",
        "guided-form",
        "multi-select-list",
        "selection-list",
      ],
    );
    for (const definition of BUILTIN_VIEW_RENDERER_DEFINITIONS) {
      expect(definition.ui.type).toBe("stack");
      expect(definition.rule?.trim()).toBeTruthy();
    }
  });

  it("looks up a built-in by slug", () => {
    expect(getBuiltinViewRendererDefinition("approval-card")?.name).toBe(
      "Approval card",
    );
    expect(getBuiltinViewRendererDefinition("nope")).toBeNull();
  });

  it("built-ins compile into catalog view components", () => {
    const catalog = buildChatViewCatalog([
      ...BUILTIN_VIEW_RENDERER_DEFINITIONS,
    ]);
    expect(catalog.definitionComponents.get("ApprovalCard")?.slug).toBe(
      "approval-card",
    );
    expect(catalog.definitionComponents.get("SelectionList")?.slug).toBe(
      "selection-list",
    );
    expect(catalog.definitionComponents.get("MultiSelectList")?.slug).toBe(
      "multi-select-list",
    );
    expect(catalog.definitionComponents.get("GuidedForm")?.slug).toBe(
      "guided-form",
    );
    expect(catalog.definitionComponents.get("GuidedFlowCommand")?.slug).toBe(
      "guided-flow-command",
    );
  });
});
