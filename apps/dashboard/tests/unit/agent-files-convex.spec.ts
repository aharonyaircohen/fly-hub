/**
 * Unit tests for the Convex-backed agent identity store
 * (src/dashboard/lib/agent-files.ts): immutable definitions with the right
 * tenantId, ticked-markdown round-tripping, and capability frontmatter.
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

vi.mock("@kody-ade/base/github/core", () => ({
  getOctokit: () => ({}) as never,
  getOwner: () => "acme",
  getRepo: () => "widgets",
  invalidateStaffCache: vi.fn(),
}));

import {
  deleteAgentFile,
  listAgentFiles,
  readAgentFile,
  writeAgentFile,
} from "@dashboard/lib/agent-files";

const RAW = [
  "---",
  "capabilities: [plan, review]",
  "subagents: [security-reviewer, release-scout]",
  "---",
  "# Release Manager",
  "",
  "Owns the release train.",
  "",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("agent files convex store", () => {
  it("lists agents parsed from raw ticked markdown", async () => {
    convex.query.mockResolvedValue([
      {
        slug: "release",
        bundle: { schemaVersion: 1, files: { "agent.md": RAW } },
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);

    const agents = await listAgentFiles();

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      slug: "release",
      title: "Release Manager",
      source: "local",
      readOnly: false,
      capabilities: ["plan", "review"],
      subagents: ["security-reviewer", "release-scout"],
    });
    expect(agents[0]!.body).toContain("Owns the release train.");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("definitions:listCurrent");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "agent" });
  });

  it("reads one agent by slug and rejects invalid slugs", async () => {
    convex.query
      .mockResolvedValueOnce({
        slug: "release",
        bundle: { schemaVersion: 1, files: { "agent.md": RAW } },
        updatedAt: "2026-07-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce(null);

    expect((await readAgentFile("release"))?.slug).toBe("release");
    expect(await readAgentFile("missing")).toBeNull();
    expect(await readAgentFile("Bad Slug!")).toBeNull();
  });

  it("publishes a versioned agent definition", async () => {
    convex.mutation.mockResolvedValue("id-1");

    const saved = await writeAgentFile({
      slug: "release",
      title: "Release Manager",
      body: "Owns the release train.",
      capabilities: ["plan"],
      subagents: ["release-scout"],
    });

    expect(saved.title).toBe("Release Manager");
    expect(saved.capabilities).toEqual(["plan"]);
    expect(saved.subagents).toEqual(["release-scout"]);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("definitions:publish");
    const typed = args as {
      tenantId: string;
      kind: string;
      slug: string;
      version: string;
      bundle: { schemaVersion: number; files: Record<string, string> };
      createdAt: string;
    };
    expect(typed.tenantId).toBe("acme/widgets");
    expect(typed.kind).toBe("agent");
    expect(typed.slug).toBe("release");
    expect(typed.version).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(typed.bundle.files["agent.md"]).toContain("# Release Manager");
    expect(typed.bundle.files["agent.md"]).toContain("Owns the release train.");
    expect(typed.bundle.files["agent.md"]).toContain(
      "subagents: [release-scout]",
    );
  });

  it("rejects invalid slugs on write", async () => {
    await expect(
      writeAgentFile({
        slug: "Bad Slug!",
        title: "x",
        body: "y",
      }),
    ).rejects.toThrow(/Invalid agent slug/);
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("retires the current agent definition", async () => {
    convex.mutation.mockResolvedValue(null);

    await deleteAgentFile("release");

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("definitions:retire");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      kind: "agent",
      slug: "release",
    });
  });
});
