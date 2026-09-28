import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@kody-ade/backend/api", () => ({ api: { repoDocs: { get: "repoDocs:get", listByPrefix: "repoDocs:listByPrefix", save: "repoDocs:save", remove: "repoDocs:remove" } } }));
vi.mock("@kody-ade/backend/client", () => ({ createBackendClient: () => backend }));
vi.mock("../src/github", () => ({ getOwner: () => "acme", getRepo: () => "app", getOctokit: () => ({}) }));

import { listRepoCommandFiles, readCommandFile, writeCommandFile } from "../src/commands/files";

describe("Convex command storage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists and reads local commands from repoDocs", async () => {
    const doc = { description: "Review", argumentHint: "<pr>", body: "Review $ARGUMENTS" };
    backend.query.mockResolvedValueOnce([{ kind: "command:review", doc, updatedAt: "2026-01-02" }]).mockResolvedValueOnce(null);
    await expect(listRepoCommandFiles()).resolves.toMatchObject({ commands: [{ slug: "review", source: "repo" }], builtinsDisabled: false });
    backend.query.mockResolvedValueOnce({ doc, updatedAt: "2026-01-02" });
    await expect(readCommandFile("review")).resolves.toMatchObject({ slug: "review", body: "Review $ARGUMENTS" });
  });

  it("writes local commands to Convex", async () => {
    backend.mutation.mockResolvedValue(undefined);
    backend.query.mockResolvedValue({ doc: { description: "Review", argumentHint: "", body: "Review" }, updatedAt: "2026-01-02" });
    await writeCommandFile({ octokit: {} as never, slug: "review", description: "Review", body: "Review" });
    expect(backend.mutation).toHaveBeenCalledWith("repoDocs:save", expect.objectContaining({ tenantId: "acme/app", kind: "command:review" }));
  });
});
