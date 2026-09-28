import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"
const definition = (name: string) => ({ name, agent: "kody" })

describe("workflows", () => {
  it("saves and lists definitions scoped to a tenant", async () => {
    const t = setup()
    await t.mutation(api.workflows.save, {
      tenantId: TENANT,
      workflowId: "deploy",
      definition: definition("Deploy"),
      source: "local",
      updatedAt: NOW,
    })
    await t.mutation(api.workflows.save, {
      tenantId: "other/tenant",
      workflowId: "deploy",
      definition: definition("Other"),
      source: "local",
      updatedAt: NOW,
    })

    const list = await t.query(api.workflows.list, { tenantId: TENANT })
    expect(list).toHaveLength(1)
    expect(list[0].definition.name).toBe("Deploy")
  })

  it("upserts instead of duplicating on re-save", async () => {
    const t = setup()
    const args = {
      tenantId: TENANT,
      workflowId: "deploy",
      definition: definition("Deploy"),
      source: "local" as const,
      updatedAt: NOW,
    }
    await t.mutation(api.workflows.save, args)
    await t.mutation(api.workflows.save, {
      ...args,
      definition: definition("Deploy v2"),
    })

    const list = await t.query(api.workflows.list, { tenantId: TENANT })
    expect(list).toHaveLength(1)
    expect(list[0].definition.name).toBe("Deploy v2")
  })

  it("preserves the Engine execution policy for every workflow step", async () => {
    const t = setup()
    const workflow = {
      ...definition("Chore"),
      capabilities: ["run", "review", "fix"],
      startAt: "run",
      report: {
        type: "workflow-summary",
        owner: "chore",
        slug: "chore",
        title: "Chore",
      },
      steps: [
        {
          id: "run",
          capability: "run",
          input: { issue: 3926 },
          action: "run",
          evidence: "facts.issue_number",
          target: "issue" as const,
          delivery: "pull-request" as const,
          targetFact: "facts.issue_number",
          reason: "Implement and deliver the requested change.",
          approval: "required" as const,
          runWhen: { "facts.ready": true },
          continueOn: ["completed"],
          saveReport: true,
          report: { channel: "workflow" },
          next: [{ to: "review" }],
        },
      ],
    }

    await t.mutation(api.workflows.save, {
      tenantId: TENANT,
      workflowId: "chore",
      definition: workflow,
      source: "store",
      updatedAt: NOW,
    })

    const got = await t.query(api.workflows.get, {
      tenantId: TENANT,
      workflowId: "chore",
    })
    expect(got?.definition).toEqual(workflow)
  })

  it("gets a single definition and returns null when missing", async () => {
    const t = setup()
    expect(await t.query(api.workflows.get, { tenantId: TENANT, workflowId: "nope" })).toBeNull()
    await t.mutation(api.workflows.save, {
      tenantId: TENANT,
      workflowId: "deploy",
      definition: definition("Deploy"),
      source: "store",
      updatedAt: NOW,
    })
    const got = await t.query(api.workflows.get, { tenantId: TENANT, workflowId: "deploy" })
    expect(got?.source).toBe("store")
  })

  it("rejects definitions that violate the schema", async () => {
    const t = setup()
    await expect(
      t.mutation(api.workflows.save, {
        tenantId: TENANT,
        workflowId: "bad",
        definition: {},
        source: "local",
        updatedAt: NOW,
      }),
    ).rejects.toThrow()
    await expect(
      t.mutation(api.workflows.save, {
        tenantId: TENANT,
        workflowId: "bad",
        definition: { ...definition("X"), unknownField: true },
        source: "local",
        updatedAt: NOW,
      }),
    ).rejects.toThrow()
  })

  it("removes a definition idempotently", async () => {
    const t = setup()
    await t.mutation(api.workflows.save, {
      tenantId: TENANT,
      workflowId: "deploy",
      definition: definition("Deploy"),
      source: "local",
      updatedAt: NOW,
    })
    await t.mutation(api.workflows.remove, { tenantId: TENANT, workflowId: "deploy" })
    await t.mutation(api.workflows.remove, { tenantId: TENANT, workflowId: "deploy" })
    expect(await t.query(api.workflows.list, { tenantId: TENANT })).toHaveLength(0)
  })
})
