import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: {
    repoDocs: { listByPrefix: "list", get: "get", save: "save", remove: "remove" },
  },
  getConvexClient: () => backend,
}));

import {
  listPersonalCommands,
  savePersonalCommand,
  savePersonalInstructions,
} from "@dashboard/lib/personal-documents";

describe("personal documents", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists commands only from the supplied user tenant", async () => {
    backend.query.mockResolvedValue([
      {
        kind: "command:review",
        doc: { description: "Review", argumentHint: "", body: "Review this" },
        updatedAt: "now",
      },
    ]);
    await expect(listPersonalCommands("user:one")).resolves.toEqual([
      expect.objectContaining({ slug: "review", body: "Review this" }),
    ]);
    expect(backend.query).toHaveBeenCalledWith("list", {
      tenantId: "user:one",
      prefix: "command:",
    });
  });

  it("stores commands and instructions in typed documents under the user tenant", async () => {
    await savePersonalCommand("user:one", {
      slug: "plan",
      description: "Plan",
      argumentHint: "<task>",
      body: "Plan $ARGUMENTS",
    });
    await savePersonalInstructions("user:one", "Be concise");
    expect(backend.mutation).toHaveBeenNthCalledWith(
      1,
      "save",
      expect.objectContaining({
        tenantId: "user:one",
        kind: "command:plan",
        doc: expect.objectContaining({ body: "Plan $ARGUMENTS" }),
      }),
    );
    expect(backend.mutation).toHaveBeenNthCalledWith(
      2,
      "save",
      expect.objectContaining({
        tenantId: "user:one",
        kind: "instructions",
        doc: { body: "Be concise" },
      }),
    );
  });
});
