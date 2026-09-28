import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listSource = readFileSync(
  "app/api/kody/company/workflows/route.ts",
  "utf8",
);
const detailSource = readFileSync(
  "app/api/kody/company/workflows/[id]/route.ts",
  "utf8",
);
const backendValidatorSource = readFileSync(
  "../../packages/kody-backend/convex/validators.ts",
  "utf8",
);

describe("Workflow API boundary", () => {
  it("reads Workflows only from the Workflow stores", () => {
    expect(listSource).toContain("listCompanyStoreWorkflowDefinitionFiles");
    expect(listSource).toContain("effectiveActiveWorkflowIds");
    expect(detailSource).toContain("effectiveActiveWorkflowIds");
    expect(detailSource).toContain("isBuiltInWorkflow");
    expect(detailSource).toContain('searchParams.get("includeStore")');
    expect(listSource).toContain("reconcileProjectedStoreWorkflows");
    expect(listSource).not.toContain("if (projected.length > 0)");
    expect(listSource).not.toContain(
      "listCompanyStoreCapabilityWorkflowDefinitionFiles",
    );
    expect(detailSource).not.toContain(
      "readCompanyStoreCapabilityWorkflowDefinitionFile",
    );
  });

  it("keeps Workflow validation and approval behavior", () => {
    expect(listSource).toContain("validateWorkflowDefinition");
    expect(listSource).toContain("runWithoutApproval");
    expect(listSource).toContain(
      "report: z.record(z.string(), z.unknown()).optional()",
    );
    expect(listSource).not.toContain("workflowInputMappingSchema");
    expect(detailSource).toContain("validateWorkflowDefinition");
    expect(detailSource).toContain(
      "report: z.record(z.string(), z.unknown()).optional()",
    );
    expect(detailSource).not.toContain("workflowInputMappingSchema");
  });

  it("resolves every referenced capability before saving", () => {
    expect(listSource).toContain("unresolvedWorkflowCapabilityIssues");
    expect(detailSource).toContain("unresolvedWorkflowCapabilityIssues");
    expect(listSource).toContain("activeStoreSlugs");
    expect(detailSource).toContain("activeStoreSlugs");
  });

  it("persists the Workflow input schema in the backend definition", () => {
    expect(backendValidatorSource).toContain(
      "inputSchema: v.optional(v.any())",
    );
  });
});
