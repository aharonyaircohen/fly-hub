import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-07-18T12:00:00.000Z";

async function saveProposal(
  t: ReturnType<typeof setup>,
  proposalId: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  await t.mutation(api.repoDocs.save, {
    tenantId: TENANT,
    kind: `definition-proposal:${proposalId}`,
    doc: { proposalId, status: "pending-review", files },
    updatedAt: NOW,
  });
}

describe("definition proposals", () => {
  it("atomically activates approved definition and workflow files", async () => {
    const t = setup();
    await saveProposal(t, "issue-42-abc", [
      { path: "agents/reviewer.md", content: "# Reviewer\n" },
      {
        path: "capabilities/review/contract.json",
        content: '{"input":{},"output":{}}\n',
      },
      { path: "capabilities/review/instructions.md", content: "# Review\n" },
      {
        path: "workflows/review.json",
        content: JSON.stringify({
          name: "Review",
          agent: "kody",
          steps: [{ id: "review", capability: "review" }],
        }),
      },
    ]);

    await t.mutation(api.definitionProposals.decide, {
      tenantId: TENANT,
      proposalId: "issue-42-abc",
      decision: "approve",
      decidedAt: NOW,
    });

    expect(
      await t.query(api.definitions.getCurrent, {
        tenantId: TENANT,
        kind: "agent",
        slug: "reviewer",
      }),
    ).toMatchObject({
      source: "local",
      bundle: { files: { "agent.md": "# Reviewer\n" } },
    });
    expect(
      await t.query(api.definitions.getCurrent, {
        tenantId: TENANT,
        kind: "capability",
        slug: "review",
      }),
    ).toMatchObject({
      source: "local",
      bundle: {
        files: {
          "contract.json": '{"input":{},"output":{}}\n',
          "instructions.md": "# Review\n",
        },
      },
    });
    expect(
      await t.query(api.workflows.get, {
        tenantId: TENANT,
        workflowId: "review",
      }),
    ).toMatchObject({
      source: "local",
      definition: { name: "Review", agent: "kody" },
    });
  });

  it("keeps rejected proposals inactive and prevents a second decision", async () => {
    const t = setup();
    await saveProposal(t, "issue-9-def", [
      { path: "agents/reviewer.md", content: "# Reviewer\n" },
    ]);

    await t.mutation(api.definitionProposals.decide, {
      tenantId: TENANT,
      proposalId: "issue-9-def",
      decision: "reject",
      decidedAt: NOW,
    });

    expect(
      await t.query(api.definitions.getCurrent, {
        tenantId: TENANT,
        kind: "agent",
        slug: "reviewer",
      }),
    ).toBeNull();
    await expect(
      t.mutation(api.definitionProposals.decide, {
        tenantId: TENANT,
        proposalId: "issue-9-def",
        decision: "approve",
        decidedAt: NOW,
      }),
    ).rejects.toThrow("already decided");
  });
});
