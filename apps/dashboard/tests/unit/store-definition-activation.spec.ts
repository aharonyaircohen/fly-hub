import { describe, expect, it, vi } from "vitest";

import { publishStoreExecutionDefinitions } from "@dashboard/lib/store-definition-activation";
import { syncStoreWorkflowExecutionDefinitions } from "@dashboard/lib/store-workflow-execution-sync";

const h = vi.hoisted(() => ({
  companyStoreAssetPath: vi.fn(),
  listCompanyStoreDirectorySafe: vi.fn(),
  readCompanyStoreText: vi.fn(),
  readCompanyStoreCapabilityFolderFiles: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@kody-ade/base/company-store/assets", () => ({
  companyStoreAssetPath: h.companyStoreAssetPath,
  listCompanyStoreDirectorySafe: h.listCompanyStoreDirectorySafe,
  readCompanyStoreText: h.readCompanyStoreText,
}));
vi.mock("@dashboard/lib/capabilities", () => ({
  readCompanyStoreCapabilityFolderFiles:
    h.readCompanyStoreCapabilityFolderFiles,
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ mutation: h.publish }),
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: { definitions: { publish: "definitions:publish" } },
}));

describe("Store execution-definition activation", () => {
  it("publishes the selected Agent, Capabilities, and shared runtime files", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);

    await publishStoreExecutionDefinitions({
      tenantId: "acme/widgets",
      agents: { "memory-steward": "# Memory Steward\n" },
      capabilities: {
        "extract-run-learning": {
          "instructions.md": "# Extract\n",
          "tools/kody-memory.mjs": "export {};\n",
        },
      },
      shared: {
        "tools/kody-memory-client.mjs": "export async function call() {}\n",
      },
      createdAt: "2026-07-26T10:00:00.000Z",
      publish,
    });

    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "acme/widgets",
        kind: "agent",
        slug: "memory-steward",
        source: "store",
        bundle: {
          schemaVersion: 1,
          files: { "agent.md": "# Memory Steward\n" },
        },
        version: expect.stringMatching(/^sha256:/),
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "capability",
        slug: "extract-run-learning",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "asset",
        slug: "company-store-shared",
      }),
    );
  });

  it("publishes nothing when there are no execution definitions", async () => {
    const publish = vi.fn();

    await publishStoreExecutionDefinitions({
      tenantId: "acme/widgets",
      agents: {},
      capabilities: {},
      shared: {},
      createdAt: "2026-07-26T10:00:00.000Z",
      publish,
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it("refreshes the exact Store agent and capabilities required by a workflow", async () => {
    h.companyStoreAssetPath.mockImplementation(
      async (_octokit: unknown, kind: string, ...parts: string[]) =>
        [kind, ...parts].join("/"),
    );
    h.readCompanyStoreText.mockImplementation(async (_octokit, path) => {
      if (path === "agents/kody.md") return "# Kody\n";
      if (path === "shared/helper.mjs") return "export {};\n";
      return null;
    });
    h.readCompanyStoreCapabilityFolderFiles.mockImplementation(async (slug) =>
      slug === "fix-ci"
        ? {
            "instructions.md": "# Fix CI\n",
            "tools/run.sh": "#!/bin/sh\n",
          }
        : null,
    );
    h.listCompanyStoreDirectorySafe.mockImplementation(async (_octokit, path) =>
      path === "shared" ? [{ name: "helper.mjs", type: "file" }] : [],
    );

    await syncStoreWorkflowExecutionDefinitions({
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      workflow: {
        name: "CI Repair",
        agent: "kody",
        capabilities: ["run", "fix-ci"],
        createdAt: "2026-08-13T09:00:00.000Z",
        updatedAt: "2026-08-13T09:00:00.000Z",
      },
      now: () => "2026-08-13T10:00:00.000Z",
    });

    expect(h.readCompanyStoreCapabilityFolderFiles).toHaveBeenCalledTimes(1);
    expect(h.readCompanyStoreCapabilityFolderFiles).toHaveBeenCalledWith(
      "fix-ci",
      {},
    );
    expect(h.publish).toHaveBeenCalledTimes(3);
    expect(h.publish).toHaveBeenCalledWith(
      "definitions:publish",
      expect.objectContaining({
        tenantId: "acme/widgets",
        kind: "capability",
        slug: "fix-ci",
        version: expect.stringMatching(/^sha256:/),
      }),
    );
  });
});
