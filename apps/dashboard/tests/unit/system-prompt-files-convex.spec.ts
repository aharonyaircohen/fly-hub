/**
 * Unit tests for the Convex-backed system prompt store
 * (src/dashboard/lib/system-prompt/files.ts): repoDocs get/save/remove with
 * kind "system-prompt" and `{ body }` doc shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOwner: () => "acme",
  getRepo: () => "widgets",
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  deleteSystemPromptFile,
  readSystemPromptFile,
  writeSystemPromptFile,
} from "@dashboard/lib/system-prompt/files";

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("system prompt convex store", () => {
  it("reads the system-prompt repoDoc", async () => {
    convex.query.mockResolvedValue({
      doc: { body: "You are Kody.\n" },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    const file = await readSystemPromptFile();

    expect(file?.body).toBe("You are Kody.\n");
    expect(file?.updatedAt).toBe("2026-07-01T00:00:00.000Z");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:get");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "system-prompt" });
  });

  it("returns null when the doc is missing or malformed", async () => {
    convex.query.mockResolvedValue(null);
    expect(await readSystemPromptFile()).toBeNull();

    convex.query.mockResolvedValue({ doc: {}, updatedAt: "x" });
    expect(await readSystemPromptFile()).toBeNull();
  });

  it("writes the prompt with a trailing newline via repoDocs.save", async () => {
    convex.mutation.mockResolvedValue("id-1");

    const file = await writeSystemPromptFile({ body: "Custom prompt" });

    expect(file.body).toBe("Custom prompt\n");
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:save");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      kind: "system-prompt",
      doc: { body: "Custom prompt\n" },
    });
  });

  it("deletes the prompt via repoDocs.remove", async () => {
    convex.mutation.mockResolvedValue(null);

    await deleteSystemPromptFile();

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:remove");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "system-prompt" });
  });
});
