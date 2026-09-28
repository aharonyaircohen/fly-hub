import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { NOW, validInboxEntry } from "../fixtures"
import { setup } from "./helpers"

const TENANT = "acme/app"

describe("inbox", () => {
  it("upserts entries and lists newest first", async () => {
    const t = setup()
    await t.mutation(api.inbox.upsert, {
      tenantId: TENANT,
      login: "octocat",
      entryId: "e1",
      entry: validInboxEntry({ id: "e1", title: "old" }),
      sentAt: "2026-01-01T00:00:00Z",
    })
    await t.mutation(api.inbox.upsert, {
      tenantId: TENANT,
      login: "octocat",
      entryId: "e2",
      entry: validInboxEntry({ id: "e2", title: "new" }),
      sentAt: "2026-06-01T00:00:00Z",
    })
    await t.mutation(api.inbox.upsert, {
      tenantId: TENANT,
      login: "octocat",
      entryId: "e1",
      entry: validInboxEntry({ id: "e1", title: "old", readAt: NOW }),
      sentAt: "2026-01-01T00:00:00Z",
      readAt: NOW,
    })

    const inbox = await t.query(api.inbox.list, { tenantId: TENANT, login: "octocat" })
    expect(inbox).toHaveLength(2)
    expect(inbox[0].entry.title).toBe("new")
    expect(inbox[1].readAt).toBe(NOW)
  })
})

describe("inbox schema enforcement", () => {
  it("persists a pipeline approval request", async () => {
    const t = setup()
    await t.mutation(api.inbox.upsert, {
      tenantId: TENANT,
      login: "octocat",
      entryId: "approval",
      entry: validInboxEntry({
        id: "approval",
        source: "request",
        pipelineApproval: {
          pipelineId: "qa-maintenance",
          runId: "run-qa-approval",
          issue: 57,
        },
      }),
      sentAt: NOW,
    })

    const inbox = await t.query(api.inbox.list, {
      tenantId: TENANT,
      login: "octocat",
    })
    expect(inbox[0].entry.pipelineApproval).toEqual({
      pipelineId: "qa-maintenance",
      runId: "run-qa-approval",
      issue: 57,
    })
  })

  it("rejects an entry with an unknown source", async () => {
    const t = setup()
    await expect(
      t.mutation(api.inbox.upsert, {
        tenantId: TENANT,
        login: "octocat",
        entryId: "bad",
        entry: validInboxEntry({ source: "carrier-pigeon" }),
        sentAt: NOW,
      }),
    ).rejects.toThrow()
  })
})
