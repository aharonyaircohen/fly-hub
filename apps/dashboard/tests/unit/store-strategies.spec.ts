import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  companyStoreAssetPath: vi.fn(async () => "catalog/strategies/healthy-ci"),
  readCompanyStoreText: vi.fn(),
}));
vi.mock("@kody-ade/base/company-store/assets", () => store);

import { readStoreStrategy } from "../../src/dashboard/lib/store-strategies";

const blueprint = {
  schemaVersion: 1,
  kind: "strategy-blueprint",
  id: "healthy-ci",
  version: "1.0.0",
  name: "Healthy CI",
  outcome: "Build native CI",
  instructions: "instructions.md",
  constraints: ["Preserve security policy"],
  application: {
    workflowId: "apply-strategy",
    activate: [{ kind: "solution", id: "ci-repair" }],
  },
  verification: { criteria: ["CI passes"] },
  compatibility: {
    repositoryTypes: ["javascript"],
    providers: ["github-actions"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  store.readCompanyStoreText.mockImplementation(async (_octokit, path) =>
    path.endsWith("strategy.json")
      ? JSON.stringify(blueprint)
      : "Inspect the repository.",
  );
});

describe("Store Strategies", () => {
  it("reads and validates the Blueprint with its instructions", async () => {
    await expect(readStoreStrategy({} as never, "healthy-ci")).resolves.toEqual(
      {
        blueprint,
        instructions: "Inspect the repository.",
      },
    );
  });

  it("rejects a Blueprint whose folder and id disagree", async () => {
    store.readCompanyStoreText.mockResolvedValueOnce(
      JSON.stringify({ ...blueprint, id: "other" }),
    );

    await expect(readStoreStrategy({} as never, "healthy-ci")).rejects.toThrow(
      /mismatched id/,
    );
  });
});
