import { describe, expect, it, vi } from "vitest";

const capabilities = vi.hoisted(() => ({
  findMissingCapabilitySlugs: vi.fn(),
  readResolvedCapabilityFile: vi.fn(),
}));

vi.mock("@kody-ade/agency/capabilities", () => capabilities);

import {
  resolveWorkflowCapabilities,
  unresolvedWorkflowCapabilityIssues,
  workflowValidationMessage,
} from "../../src/dashboard/lib/capabilities/resolve-workflow";

const workflow = {
  name: "Extract exercises",
  agent: "kody",
  capabilities: ["extract-pdf-exercises"],
  steps: [
    { id: "extract", capability: "extract-pdf-exercises" },
    { id: "review", capability: "review-exercises" },
  ],
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
};

describe("workflow capability resolution", () => {
  it("reports only capabilities missing from the resolved sources", async () => {
    capabilities.findMissingCapabilitySlugs.mockResolvedValue([
      "review-exercises",
    ]);

    await expect(
      unresolvedWorkflowCapabilityIssues(workflow, { octokit: {} as never }),
    ).resolves.toEqual([
      {
        code: "unknown_capability",
        path: "steps[1].capability",
        message: expect.stringContaining("review-exercises"),
      },
    ]);
  });

  it("returns resolved capability details for the workflow references", async () => {
    capabilities.readResolvedCapabilityFile
      .mockResolvedValueOnce({ slug: "extract-pdf-exercises" })
      .mockResolvedValueOnce({ slug: "review-exercises" });

    await expect(
      resolveWorkflowCapabilities(workflow, { octokit: {} as never }),
    ).resolves.toEqual([
      { slug: "extract-pdf-exercises" },
      { slug: "review-exercises" },
    ]);
  });

  it("explains why a workflow cannot be saved", () => {
    expect(
      workflowValidationMessage([
        { code: "unknown", path: "steps[0]", message: "Input is missing." },
      ]),
    ).toBe("Workflow is not safe to save: Input is missing.");
  });
});
