import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
const mutation = vi.hoisted(() => vi.fn());

vi.mock("@kody-ade/backend/api", () => ({
  api: { repoDocs: { get: "repoDocs.get", save: "repoDocs.save" } },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query, mutation }),
}));

import { createBackendCmsRepoDocsStore } from "@kody-ade/kody-chat-dashboard/cms-backend-store";

describe("Dashboard CMS Backend adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the CMS files document through the repository-scoped Backend key", async () => {
    query.mockResolvedValue({
      doc: { files: { "cms/config.json": "{}" } },
      updatedAt: "version-1",
    });

    await expect(
      createBackendCmsRepoDocsStore().load("acme", "shop"),
    ).resolves.toEqual({
      doc: { files: { "cms/config.json": "{}" } },
      updatedAt: "version-1",
    });
    expect(query).toHaveBeenCalledWith("repoDocs.get", {
      tenantId: "acme/shop",
      kind: "cms:files",
    });
  });

  it("preserves optimistic concurrency when saving", async () => {
    mutation.mockResolvedValue(undefined);

    const updatedAt = await createBackendCmsRepoDocsStore().save(
      "acme",
      "shop",
      { files: { "cms/config.json": "{}" } },
      "version-1",
    );

    expect(updatedAt).toEqual(expect.any(String));
    expect(mutation).toHaveBeenCalledWith(
      "repoDocs.save",
      expect.objectContaining({
        tenantId: "acme/shop",
        kind: "cms:files",
        doc: { files: { "cms/config.json": "{}" } },
        expectedUpdatedAt: "version-1",
        updatedAt,
      }),
    );
  });
});
